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
import { and, eq, gte, inArray, lte, ne, or, isNull, sql } from "drizzle-orm";
import { channels, jobRuns, scheduledPosts, settings, videoAssets, videoMetadata } from "../db/schema";
import { activeSlotCount, generateSlotsFromBaseTimes, todayInTimezone } from "./slots";
import { decryptSecret } from "./crypto";
import {
  classifyFailure,
  createPost,
  getPost,
  isRetryable,
  readPostStatus,
  unwrapPost,
  uploadMedia,
  type FailureKind,
} from "./zernio";
import type { Env } from "../index";

export interface DispatchMessage {
  postId: string;
}

/** Hasil satu dispatch. Field `retryable` yang menentukan ack() atau retry(). */
export interface DispatchOutcome {
  ok: boolean;
  kind?: FailureKind;
  retryable: boolean;
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
  /**
   * Jadwal datang dari JAM DASAR + pergeseran harian (lihat schema.baseTimes),
   * bukan dari jendela + jitter acak. Ini yang diminta operator dan yang
   * disepakati sebagai kuota: 5 upload/hari, seluruh jam bergeser 5 menit tiap
   * hari, reset saat jam terakhir menyentuh 00:00.
   */
  const slotTimes = generateSlotsFromBaseTimes(todayISO, {
    baseTimes: channel.baseTimes.split(",").map((s) => s.trim()).filter(Boolean),
    driftMinutesPerDay: channel.driftMinutesPerDay,
    // Tanpa anchor tersimpan, pakai hari ini — pola dimulai dari jam dasar.
    anchorDate: channel.driftAnchorDate ?? todayISO,
    timezone: channel.timezone,
    activeDays: channel.activeDays ? channel.activeDays.split(",").filter(Boolean) : [],
    count: slotsAllowed,
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
export async function dispatchPost(env: Env, postId: string): Promise<DispatchOutcome> {
  const db = drizzle(env.DB);

  // Klaim post-nya. Kalau bukan 'queued' lagi, ada yang sudah menanganinya.
  const claimed = await db
    .update(scheduledPosts)
    .set({ status: "dispatching", updatedAt: nowIso() })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "queued")))
    .returning();
  // Sudah ditangani proses lain — bukan kegagalan, dan jangan diulang.
  if (claimed.length === 0) return { ok: true, retryable: false };

  const post = claimed[0]!;

  /**
   * Mencatat kegagalan BESERTA klasifikasinya (PRD F6), dan memberi tahu
   * pemanggil apakah pantas diulang.
   *
   * Kegagalan channel (kunci dicabut, kuota habis) tidak boleh diulang: tiga
   * percobaan tambahan tidak akan menolong, hanya menunda alert yang justru
   * dibutuhkan operator.
   */
  const fail = async (reason: string): Promise<DispatchOutcome> => {
    const kind = classifyFailure(reason);
    await db
      .update(scheduledPosts)
      .set({
        status: "failed",
        failReason: `[${kind}] ${reason}`.slice(0, 500),
        updatedAt: nowIso(),
      })
      .where(eq(scheduledPosts.id, postId));
    await db
      .update(videoAssets)
      .set({ status: "failed", updatedAt: nowIso() })
      .where(eq(videoAssets.id, post.videoId));
    return { ok: false, kind, retryable: isRetryable(kind) };
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
    return { ok: true, retryable: false };
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

  /**
   * Caption dan hashtag digabung jadi SATU badan teks — keputusan operator.
   *
   * Zernio tidak punya field `tags` terpisah untuk YouTube, jadi ini bukan
   * kompromi sementara melainkan bentuk finalnya. Ditulis eksplisit supaya
   * tidak ada yang mengira tag hilang karena bug.
   *
   * Tag dinormalkan jadi hashtag yang sah: spasi dan karakter non-alfanumerik
   * dibuang (YouTube memutus hashtag pada karakter pertama yang tidak sah,
   * jadi "#konten kecantikan" hanya terbaca sebagai "#konten"), dan duplikat
   * dibuang supaya tag dasar channel tidak muncul dua kali.
   */
  const tags = meta.tagsJson ? (JSON.parse(meta.tagsJson) as string[]) : [];
  const hashtags = [
    ...new Set(
      tags
        .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter(Boolean)
        .map((t) => `#${t}`),
    ),
  ];
  const description = [meta.description ?? "", hashtags.join(" ")].filter(Boolean).join("\n\n");

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

  return { ok: true, retryable: false };
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

/**
 * Dead-man's-switch (PRD F10): mendeteksi cron harian yang TIDAK berjalan.
 *
 * Kegagalan paling berbahaya di sistem terjadwal bukan job yang error — itu
 * tercatat dan terlihat. Yang berbahaya adalah job yang tidak pernah jalan
 * sama sekali: tidak ada error, tidak ada log, tidak ada baris. Dari dashboard
 * ia tampak persis seperti "hari ini kebetulan tidak ada yang dijadwalkan".
 *
 * Diperiksa oleh cron 10-menitan. Ambangnya beberapa jam setelah build
 * seharusnya berjalan, supaya keterlambatan wajar tidak memicu alarm palsu.
 */
export async function checkDailyBuildRan(env: Env): Promise<{ ran: boolean; alerted: boolean }> {
  const db = drizzle(env.DB);

  // Build dijadwalkan 18:00 UTC. Beri kelonggaran 6 jam sebelum menyimpulkan
  // ia benar-benar terlewat.
  const now = new Date();
  const since = new Date(now.getTime() - 6 * 3600_000);
  if (now.getUTCHours() < 18 && since.getUTCHours() < 18) {
    // Belum melewati jendela hari ini — belum ada yang bisa disimpulkan.
    return { ran: true, alerted: false };
  }

  const cutoff = new Date(now.getTime() - 30 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const recent = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobType, "build-schedule"), gte(jobRuns.startedAt, cutoff)))
    .limit(1);

  if (recent.length > 0) return { ran: true, alerted: false };

  // Tidak ada build dalam 30 jam terakhir. Dicatat sebagai job_run gagal
  // supaya MUNCUL di Activity & Logs — ketiadaan tidak bisa dilihat, tapi
  // catatan tentang ketiadaan bisa.
  await db.insert(jobRuns).values({
    id: newId("job"),
    jobType: "dead-mans-switch",
    status: "failed",
    startedAt: nowIso(),
    finishedAt: nowIso(),
    detailJson: JSON.stringify({
      alert: "Cron build-schedule tidak berjalan dalam 30 jam terakhir.",
      periksa: "Cron trigger di dashboard Cloudflare, dan apakah Worker ter-deploy.",
    }),
  });

  return { ran: false, alerted: true };
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
