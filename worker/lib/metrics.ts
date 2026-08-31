/**
 * Sinkronisasi metrik dari Zernio ke metric_snapshots.
 *
 * Disimpan sebagai DERET WAKTU, satu baris per (post, hari), bukan satu baris
 * "terbaru" per post. Alasannya bukan kerapian: angka mentah tidak bisa
 * meranking video, karena post 3 hari SELALU mengungguli post 3 jam.
 * Perbandingan yang adil menuntut angka pada UMUR yang sama (24 jam, 72 jam),
 * dan itu hanya bisa direkonstruksi dari riwayat. Riwayat tidak bisa
 * di-backfill — yang tidak ditangkap saat kejadian, hilang selamanya.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gte } from "drizzle-orm";
import { channels, metricSnapshots, scheduledPosts } from "../db/schema";
import { decryptSecret } from "./crypto";
import { todayInTimezone } from "./slots";
import type { Env } from "../index";

/**
 * Seberapa jauh ke belakang metrik masih disegarkan. Engagement konten pendek
 * sangat terkonsentrasi di awal; lewat titik ini penyegaran harian hanya
 * menulis ulang angka yang sama. Ini juga yang membatasi pertumbuhan tabel.
 */
const ACTIVE_WINDOW_DAYS = 14;

const BASE = "https://zernio.com/api/v1";

interface ZernioAnalyticsPost {
  _id?: string;
  analytics?: Record<string, unknown>;
  platforms?: Array<{ platformPostId?: string; analytics?: Record<string, unknown> }>;
}

function num(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  }
  return null;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Menarik analitik satu channel.
 *
 * Memakai endpoint `/analytics` dasar, yang tersedia di paket tanpa add-on
 * berbayar — tidak seperti `/analytics/daily-metrics` dan endpoint insight
 * per-platform.
 */
async function fetchAnalytics(
  apiKey: string,
  since: Date,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const params = new URLSearchParams({
    fromDate: since.toISOString().slice(0, 10),
    limit: "100",
  });

  const res = await fetch(`${BASE}/analytics?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return out;

  const json = (await res.json().catch(() => null)) as { posts?: ZernioAnalyticsPost[] } | null;
  for (const post of json?.posts ?? []) {
    if (post.analytics && post._id) out.set(post._id, post.analytics);
    // Angka per-platform lebih presisi daripada rollup di level post, jadi ia
    // menimpa — walau dalam pemakaian kita satu post hanya punya satu platform.
    for (const entry of post.platforms ?? []) {
      if (!entry.analytics) continue;
      for (const id of [entry.platformPostId, post._id]) {
        if (id) out.set(id, entry.analytics);
      }
    }
  }
  return out;
}

export async function syncMetrics(env: Env): Promise<{ checked: number; written: number }> {
  const db = drizzle(env.DB);
  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000);

  // Hanya post yang benar-benar terbit dan bukan dry-run yang punya metrik.
  const posts = await db
    .select({ post: scheduledPosts, channel: channels })
    .from(scheduledPosts)
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .where(
      and(
        eq(scheduledPosts.status, "published"),
        eq(scheduledPosts.dryRun, false),
        gte(scheduledPosts.slotTimeUtc, since.toISOString().replace(/\.\d{3}Z$/, "Z")),
      ),
    );

  if (posts.length === 0) return { checked: 0, written: 0 };

  // Satu panggilan analytics per channel, bukan per post.
  const byChannel = new Map<string, Map<string, Record<string, unknown>>>();
  let written = 0;

  for (const { post, channel } of posts) {
    if (!post.zernioPostId || !channel.zernioApiKeyEnc || !env.ENCRYPTION_KEY) continue;

    if (!byChannel.has(channel.id)) {
      const apiKey = await decryptSecret(channel.zernioApiKeyEnc, env.ENCRYPTION_KEY);
      byChannel.set(channel.id, apiKey ? await fetchAnalytics(apiKey, since) : new Map());
    }

    const analytics = byChannel.get(channel.id)?.get(post.zernioPostId);
    if (!analytics) continue;

    // Hari ditentukan di timezone channel, bukan UTC — supaya "satu baris per
    // hari" berarti hari yang sama dengan yang dilihat operator.
    const capturedOn = todayInTimezone(channel.timezone);

    const raw: Record<string, unknown> = {};
    const mapped = new Set([
      "views",
      "impressions",
      "reach",
      "likes",
      "comments",
      "shares",
      "saves",
      "clicks",
      "follows",
      "engagementRate",
      "lastUpdated",
      "watchTimeSeconds",
      "estimatedMinutesWatched",
      "subscribersGained",
    ]);
    for (const [k, v] of Object.entries(analytics)) {
      // Field khusus Zernio yang tidak kita modelkan tetap disimpan mentah —
      // ia tidak bisa ditarik ulang setelah post melewati jendela analitik.
      if (!mapped.has(k) && v !== null && v !== undefined) raw[k] = v;
    }

    const lastUpdated =
      typeof analytics.lastUpdated === "string"
        ? new Date(analytics.lastUpdated.replace(" ", "T") + "Z")
        : null;

    const row = {
      id: `mtr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      scheduledPostId: post.id,
      capturedOn,
      capturedAt: nowIso(),
      providerUpdatedAt:
        lastUpdated && !Number.isNaN(lastUpdated.getTime())
          ? lastUpdated.toISOString().replace(/\.\d{3}Z$/, "Z")
          : null,
      views: num(analytics, "views"),
      watchTimeSec: num(analytics, "watchTimeSeconds", "estimatedMinutesWatched"),
      likes: num(analytics, "likes"),
      comments: num(analytics, "comments"),
      subsGained: num(analytics, "subscribersGained", "follows"),
      rawJson: Object.keys(raw).length ? JSON.stringify(raw) : null,
    };

    // Upsert pada (post, hari): sinkron beberapa kali sehari MENYEGARKAN baris
    // hari itu, bukan menumpuk duplikat.
    await db
      .insert(metricSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [metricSnapshots.scheduledPostId, metricSnapshots.capturedOn],
        set: {
          capturedAt: row.capturedAt,
          providerUpdatedAt: row.providerUpdatedAt,
          views: row.views,
          watchTimeSec: row.watchTimeSec,
          likes: row.likes,
          comments: row.comments,
          subsGained: row.subsGained,
          rawJson: row.rawJson,
        },
      });
    written++;
  }

  return { checked: posts.length, written };
}
