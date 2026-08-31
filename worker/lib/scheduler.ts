/**
 * Jantung produk: membangun antrean harian, lalu menyerahkannya ke Zernio.
 *
 * Pembagian tugas yang disengaja:
 *   Cron  -> hanya MENJADWALKAN (cepat, hemat CPU; batas 30 detik).
 *   Queue -> yang MENGUNGGAH (wall time 15 menit; satu video per pesan).
 * Menyalin video di dalam cron akan menabrak batas CPU dan meninggalkan post
 * setengah jalan — persis kondisi yang melahirkan duplikat di sistem referensi.
 */
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, inArray, lte, ne, or, isNull, sql } from "drizzle-orm";
import { channels, jobRuns, scheduledPosts, settings, videoAssets, videoMetadata } from "../db/schema";
import { activeSlotCount, generateSlots, todayInTimezone } from "./slots";
import { decryptSecret } from "./crypto";
import { createPost, getPost, readPostStatus, unwrapPost, uploadMedia } from "./zernio";
import type { Env } from "../index";

export interface DispatchMessage {
  postId: string;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Dry-run global (PRD §4) — default AKTIF bila baris settings belum ada. */
export async function isDryRun(db: DrizzleD1Database): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  return row ? row.dryRun : true;
}

/**
 * Membangun antrean hari ini untuk SATU channel.
 *
 * Hari "diklaim" lebih dulu lewat UPDATE bersyarat, bukan dibaca lalu ditulis
 * belakangan. Versi baca-dulu meninggalkan celah di mana cron dan tombol manual
 * sama-sama lolos pemeriksaan dan sama-sama mengklaim video — insiden nyata di
 * sistem referensi: 18 video terklaim ganda, 12 di antaranya sudah lewat waktu.
 *
 * Kompromi yang disengaja: bila build gagal SETELAH klaim, hari itu dianggap
 * sudah dibangun dan slotnya hilang. Itu arah yang benar — satu hari kosong
 * jauh lebih murah daripada post ganda di channel sungguhan.
 */
export async function buildScheduleForChannel(
  env: Env,
  channel: typeof channels.$inferSelect,
): Promise<
  | { status: "already_built" }
  | { status: "paused" }
  | { status: "no_videos"; slotsAllowed: number }
  | { status: "built"; built: number; slotsAllowed: number; skipped: number }
> {
  const db = drizzle(env.DB);

  if (channel.status !== "active") return { status: "paused" };

  const todayISO = todayInTimezone(channel.timezone);

  const claimed = await db
    .update(channels)
    .set({ lastBuiltDate: todayISO, updatedAt: nowIso() })
    .where(
      and(
        eq(channels.id, channel.id),
        or(isNull(channels.lastBuiltDate), ne(channels.lastBuiltDate, todayISO)),
      ),
    )
    .returning({ id: channels.id });

  if (claimed.length === 0) return { status: "already_built" };

  const slotsAllowed = activeSlotCount(channel);
  const slotTimes = generateSlots(todayISO, {
    count: slotsAllowed,
    windowStart: channel.windowStart,
    windowEnd: channel.windowEnd,
    intervalMin: channel.intervalMin,
    timezone: channel.timezone,
    activeDays: channel.activeDays ? channel.activeDays.split(",").filter(Boolean) : [],
    seed: `${channel.id}:${todayISO}`,
  });

  if (slotTimes.length === 0) return { status: "built", built: 0, slotsAllowed, skipped: 0 };

  /**
   * Klaim video dalam SATU statement.
   *
   * D1 menyerialkan tulisan, jadi satu UPDATE...RETURNING sudah atomik. Memilih
   * dulu lalu menulis belakangan membuka celah bagi pemanggil kedua untuk
   * melihat video yang sama masih `queued` dan mengklaimnya juga.
   */
  const claimedVideos = await db
    .update(videoAssets)
    .set({ status: "scheduled", updatedAt: nowIso() })
    .where(
      inArray(
        videoAssets.id,
        db
          .select({ id: videoAssets.id })
          .from(videoAssets)
          .where(and(eq(videoAssets.channelId, channel.id), eq(videoAssets.status, "queued")))
          .orderBy(videoAssets.createdAt)
          .limit(slotTimes.length),
      ),
    )
    .returning();

  if (claimedVideos.length === 0) return { status: "no_videos", slotsAllowed };

  const dryRun = await isDryRun(db);
  const created: string[] = [];

  for (let i = 0; i < claimedVideos.length; i++) {
    const video = claimedVideos[i]!;
    const slotTime = slotTimes[i]!;
    const postId = newId("post");

    try {
      await db.insert(scheduledPosts).values({
        id: postId,
        videoId: video.id,
        channelId: channel.id,
        slotTimeUtc: slotTime,
        // UNIQUE di D1. Dua proses yang berlomba tidak bisa keduanya menang.
        idempotencyKey: `${channel.id}|${video.id}|${slotTime}`,
        status: "queued",
        dryRun,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created.push(postId);
    } catch {
      // Bentrok idempotency = sudah ada yang membuat post ini. Kembalikan
      // videonya ke pool supaya tidak tersangkut di 'scheduled' selamanya.
      await db
        .update(videoAssets)
        .set({ status: "queued", updatedAt: nowIso() })
        .where(and(eq(videoAssets.id, video.id), eq(videoAssets.status, "scheduled")));
    }
  }

  if (created.length > 0) {
    await env.DISPATCH.sendBatch(created.map((postId) => ({ body: { postId } })));
  }

  return {
    status: "built",
    built: created.length,
    slotsAllowed,
    skipped: slotTimes.length - created.length,
  };
}

/**
 * Menyerahkan satu post ke Zernio: unggah media, buat post, BACA BALIK status.
 *
 * Membaca balik bukan kehati-hatian berlebihan. Zernio menjawab 200 untuk draft
 * juga, dan draft tidak pernah terbit — memperlakukan status HTTP sebagai
 * vonis adalah yang membuat sistem referensi diam 13 hari dengan centang hijau
 * di dashboard.
 */
export async function dispatchPost(env: Env, postId: string): Promise<void> {
  const db = drizzle(env.DB);

  // Klaim post-nya. Kalau bukan 'queued' lagi, ada yang sudah menanganinya.
  const claimed = await db
    .update(scheduledPosts)
    .set({ status: "dispatching", updatedAt: nowIso() })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "queued")))
    .returning();
  if (claimed.length === 0) return;

  const post = claimed[0]!;
  const fail = async (reason: string) => {
    await db
      .update(scheduledPosts)
      .set({ status: "failed", failReason: reason.slice(0, 500), updatedAt: nowIso() })
      .where(eq(scheduledPosts.id, postId));
    await db
      .update(videoAssets)
      .set({ status: "failed", updatedAt: nowIso() })
      .where(eq(videoAssets.id, post.videoId));
  };

  const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId)).limit(1);
  const [video] = await db.select().from(videoAssets).where(eq(videoAssets.id, post.videoId)).limit(1);
  const [meta] = await db
    .select()
    .from(videoMetadata)
    .where(eq(videoMetadata.videoId, post.videoId))
    .limit(1);

  if (!channel || !video) return fail("Channel atau video sudah tidak ada.");
  if (channel.status !== "active") return fail("Channel di-pause sebelum post dikirim.");
  if (!meta?.titleSelected) return fail("Metadata belum digenerate untuk video ini.");

  /**
   * DRY-RUN — ditegakkan di SERVER, bukan hanya di UI.
   *
   * Seluruh pipeline berjalan sampai titik ini; yang dilewati hanya panggilan
   * nyata ke Zernio. Kalau penegakannya ada di klien, ia bisa dilewati hanya
   * dengan memanggil endpoint langsung.
   */
  if (post.dryRun) {
    await db
      .update(scheduledPosts)
      .set({
        status: "scheduled",
        zernioPostId: null,
        failReason: null,
        dispatchedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(scheduledPosts.id, postId));
    return;
  }

  if (!channel.zernioApiKeyEnc) return fail("Channel belum punya API key Zernio.");
  if (!channel.zernioAccountId) return fail("Channel belum punya Zernio accountId.");
  if (!env.ENCRYPTION_KEY) return fail("ENCRYPTION_KEY belum diset di Worker.");

  const apiKey = await decryptSecret(channel.zernioApiKeyEnc, env.ENCRYPTION_KEY);
  if (!apiKey) return fail("Kunci Zernio tidak bisa didekripsi. Masukkan ulang di Settings.");

  // Streaming, bukan arrayBuffer(): isolate dibatasi 128 MB dan video melampaui
  // itu dengan mudah. Content-Length diambil dari metadata objek R2.
  const object = await env.VIDEOS.get(video.r2Key);
  if (!object) return fail(`Objek R2 tidak ditemukan: ${video.r2Key}`);

  const uploaded = await uploadMedia(apiKey, {
    filename: video.r2Key.split("/").pop() ?? "video.mp4",
    contentType: video.mime ?? "video/mp4",
    size: object.size,
    body: object.body,
  });
  if (!uploaded.ok) return fail(uploaded.error);

  const tags = meta.tagsJson ? (JSON.parse(meta.tagsJson) as string[]) : [];
  // Zernio tidak punya field `tags` terpisah untuk YouTube (§12), jadi tag
  // hanya bisa masuk lewat deskripsi. Ditulis eksplisit supaya tidak ada yang
  // mengira tag hilang karena bug.
  const description = [meta.description ?? "", tags.length ? tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ") : ""]
    .filter(Boolean)
    .join("\n\n");

  // Zernio menuntut ISO tanpa sufiks zona, plus timezone terpisah. Kirim jam
  // dinding UTC dengan timezone "UTC" agar kedua bagian selalu konsisten.
  const scheduledFor = post.slotTimeUtc.replace(/Z$/, "");

  const result = await createPost(apiKey, {
    accountId: channel.zernioAccountId,
    mediaUrl: uploaded.publicUrl,
    content: description,
    title: meta.titleSelected,
    visibility: channel.ytVisibility,
    categoryId: channel.ytCategory,
    madeForKids: channel.ytMadeForKids,
    scheduledFor,
    timezone: "UTC",
  });

  if (!result.ok) return fail(result.error ?? "Zernio menolak post.");

  await db
    .update(scheduledPosts)
    .set({
      status: "scheduled",
      zernioPostId: result.postId ?? null,
      failReason: null,
      dispatchedAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(scheduledPosts.id, postId));
}

/**
 * Rekonsiliasi: menanyakan ke Zernio apa yang SEBENARNYA terjadi.
 *
 * Tanpa ini, Zernio bersifat write-only dari sisi kita — kita mencatat serah
 * terima lalu tidak pernah menengok lagi, dan post yang gagal terbit tetap
 * menampilkan centang hijau selamanya.
 */
export async function reconcilePosts(env: Env, limit = 25): Promise<{ checked: number; updated: number }> {
  const db = drizzle(env.DB);

  const pending = await db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "scheduled"), eq(scheduledPosts.dryRun, false)))
    .limit(limit);

  let updated = 0;
  for (const post of pending) {
    if (!post.zernioPostId) continue;

    const [channel] = await db.select().from(channels).where(eq(channels.id, post.channelId)).limit(1);
    if (!channel?.zernioApiKeyEnc || !env.ENCRYPTION_KEY) continue;
    const apiKey = await decryptSecret(channel.zernioApiKeyEnc, env.ENCRYPTION_KEY);
    if (!apiKey) continue;

    const res = await getPost(apiKey, post.zernioPostId);
    if (!res.ok) continue;

    const { status, error, publishedAt } = readPostStatus(unwrapPost(res.json));
    const lower = status.toLowerCase();

    if (["published", "posted", "success", "completed"].some((k) => lower.includes(k))) {
      await db
        .update(scheduledPosts)
        .set({ status: "published", publishedAt: publishedAt ?? nowIso(), updatedAt: nowIso() })
        .where(eq(scheduledPosts.id, post.id));
      await db
        .update(videoAssets)
        .set({ status: "published", updatedAt: nowIso() })
        .where(eq(videoAssets.id, post.videoId));
      updated++;
    } else if (["failed", "error"].some((k) => lower.includes(k))) {
      await db
        .update(scheduledPosts)
        .set({ status: "failed", failReason: (error ?? status).slice(0, 500), updatedAt: nowIso() })
        .where(eq(scheduledPosts.id, post.id));
      await db
        .update(videoAssets)
        .set({ status: "failed", updatedAt: nowIso() })
        .where(eq(videoAssets.id, post.videoId));
      updated++;
    }
  }

  return { checked: pending.length, updated };
}

/**
 * Jaring pengaman: memungut post yang tersangkut `queued` melewati jam tayangnya
 * — misalnya karena pengiriman ke Queue gagal setelah barisnya terlanjur dibuat.
 */
export async function requeueStuckPosts(env: Env): Promise<number> {
  const db = drizzle(env.DB);
  const stuck = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, "queued"), lte(scheduledPosts.slotTimeUtc, nowIso())))
    .limit(50);

  if (stuck.length > 0) {
    await env.DISPATCH.sendBatch(stuck.map((p) => ({ body: { postId: p.id } })));
  }
  return stuck.length;
}

/** Mencatat satu jalannya job untuk audit (§11 observability). */
export async function recordJobRun(
  env: Env,
  jobType: string,
  status: "success" | "partial" | "failed",
  detail: unknown,
  startedAt: string,
): Promise<void> {
  await drizzle(env.DB)
    .insert(jobRuns)
    .values({
      id: newId("job"),
      jobType,
      status,
      startedAt,
      finishedAt: nowIso(),
      detailJson: JSON.stringify(detail),
    });
}

/** Semua channel aktif — dipakai cron harian. */
export async function activeChannels(env: Env) {
  return drizzle(env.DB).select().from(channels).where(eq(channels.status, "active"));
}

export { sql };
