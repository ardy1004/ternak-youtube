/**
 * Titik masuk Worker — melayani API di /api/* dan menyerahkan sisanya ke aset
 * statis hasil `vite build`.
 *
 * Pembagian tugasnya diatur wrangler.jsonc, bukan di sini: `run_worker_first:
 * ["/api/*"]` memastikan hanya route API yang sampai ke skrip ini. Fallback
 * ASSETS di bawah adalah jaring pengaman kalau ada permintaan lain yang lolos.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { auth } from "./routes/auth";
import { channelRoutes } from "./routes/channels";
import { videoRoutes } from "./routes/videos";
import { metadataRoutes } from "./routes/metadata";
import { opsRoutes, postRoutes, settingsRoutes } from "./routes/posts";
import { analyticsRoutes } from "./routes/analytics";
import { syncMetrics } from "./lib/metrics";
import {
  activeChannels,
  buildScheduleForChannel,
  checkDailyBuildRan,
  dispatchPost,
  recordJobRun,
  reconcilePosts,
  requeueStuckPosts,
  type DispatchMessage,
} from "./lib/scheduler";
import { requireAuth, type SessionData } from "./lib/session";

export interface Env {
  DB: D1Database;
  VIDEOS: R2Bucket;
  SESSIONS: KVNamespace;
  DISPATCH: Queue;
  ASSETS: Fetcher;

  // Diisi lewat `wrangler secret put`, tidak pernah masuk repo.
  SESSION_SECRET?: string;
  ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;

  // Kredensial S3 R2 sengaja TIDAK ada di sini. Upload memakai binding VIDEOS
  // (multipart, lihat routes/videos.ts), jadi Worker tidak pernah perlu
  // menandatangani apa pun — dan secret yang tidak ada tidak bisa bocor.
}

const api = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>().basePath("/api");

async function dbStatus(env: Env): Promise<{ ok: boolean; tables?: number; error?: string }> {
  try {
    const row = await drizzle(env.DB)
      .get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`);
    return { ok: true, tables: row?.n ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Health PUBLIK — sengaja, supaya bisa dipakai monitor uptime tanpa kredensial.
 *
 * Justru karena publik, isinya dijaga tipis: hidup/mati dan D1 tersambung atau
 * tidak. Rincian binding dan secret mana yang terpasang pindah ke /health/detail
 * di balik login — daftar secret yang BELUM diset adalah peta bagi penyerang.
 *
 * Tetap menyentuh D1: health yang tidak menguji dependensinya hanya
 * membuktikan Worker-nya hidup, dan itu bukan pertanyaan yang mahal saat
 * ada masalah.
 */
api.get("/health", async (c) => {
  const db = await dbStatus(c.env);
  return c.json({ ok: db.ok, db: { ok: db.ok } }, db.ok ? 200 : 503);
});

// Login/logout harus bisa diakses tanpa sesi — kalau tidak, tidak ada cara
// masuk. /me punya requireAuth sendiri di dalam modulnya.
api.route("/auth", auth);

/**
 * Gerbang untuk SEMUA route yang didaftarkan SETELAH baris ini.
 *
 * Hono menjalankan handler sesuai urutan pendaftaran, jadi posisi middleware
 * ini yang menentukan apa yang terbuka: apa pun di atasnya publik, apa pun di
 * bawahnya wajib sesi. Ditulis ber-wildcard supaya route baru tertutup secara
 * default — mendaftarkan proteksi satu per satu hanya butuh sekali lupa untuk
 * membocorkan endpoint.
 */
api.use("/*", requireAuth);

/** Diagnostik lengkap — hanya untuk operator yang sudah login. */
api.get("/health/detail", async (c) => {
  const started = Date.now();
  const db = await dbStatus(c.env);
  return c.json({
    ok: db.ok,
    db,
    bindings: {
      DB: Boolean(c.env.DB),
      VIDEOS: Boolean(c.env.VIDEOS),
      SESSIONS: Boolean(c.env.SESSIONS),
      DISPATCH: Boolean(c.env.DISPATCH),
    },
    // Secret dilaporkan ADA atau TIDAK — nilainya tidak pernah dikembalikan.
    secrets: {
      SESSION_SECRET: Boolean(c.env.SESSION_SECRET),
      ENCRYPTION_KEY: Boolean(c.env.ENCRYPTION_KEY),
      GEMINI_API_KEY: Boolean(c.env.GEMINI_API_KEY),
    },
    elapsedMs: Date.now() - started,
  });
});

api.route("/channels", channelRoutes);
api.route("/videos", videoRoutes);
api.route("/metadata", metadataRoutes);
api.route("/posts", postRoutes);
api.route("/settings", settingsRoutes);
api.route("/ops", opsRoutes);
api.route("/analytics", analyticsRoutes);

// Route API yang tidak dikenal harus 404 sebagai JSON, bukan jatuh ke
// index.html — kalau tidak, fetch yang salah alamat akan terlihat "berhasil"
// dan baru gagal saat parsing.
api.all("/*", (c) => c.json({ error: "Not found" }, 404));

api.onError((err, c) => {
  console.error("API error:", err);
  return c.json({ error: "Internal error" }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * Dua cron dibedakan lewat `event.cron`, bukan satu handler yang menebak.
   *
   *   "0 18 * * *"   -> 01:00 WIB, membangun antrean hari itu. Dijalankan jauh
   *                     sebelum jam tayang paling pagi supaya setiap slot sudah
   *                     antre saat waktunya tiba.
   *   "*​/10 * * * *" -> jaring pengaman + rekonsiliasi status.
   *
   * Cron dengan interval <1 jam hanya dapat 30 detik CPU, jadi handler ini
   * TIDAK boleh menyalin video. Itu tugas consumer Queue.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    if (event.cron === "0 18 * * *") {
      ctx.waitUntil(
        (async () => {
          const results: unknown[] = [];
          let failed = 0;
          // Tiap channel diisolasi: satu channel yang salah konfigurasi tidak
          // boleh menjatuhkan build channel lain.
          for (const channel of await activeChannels(env)) {
            try {
              results.push({ channel: channel.name, ...(await buildScheduleForChannel(env, channel)) });
            } catch (err) {
              failed++;
              results.push({
                channel: channel.name,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          await recordJobRun(
            env,
            "build-schedule",
            failed === 0 ? "success" : "partial",
            results,
            startedAt,
          );
        })(),
      );
      return;
    }

    ctx.waitUntil(
      (async () => {
        try {
          const deadMan = await checkDailyBuildRan(env);
          const requeued = await requeueStuckPosts(env);
          const reconciled = await reconcilePosts(env);
          // Metrik disinkronkan lebih jarang daripada rekonsiliasi: penyedia
          // menyegarkan angkanya paling cepat sekali sehari, jadi menariknya
          // tiap 10 menit tidak bisa menghasilkan data yang lebih segar —
          // hanya membakar kuota. Tiga jendela sehari sudah cukup, dan
          // penyaringan hanya pada JAM (bukan menit) membuatnya tahan
          // terhadap cron yang telat.
          const hour = new Date().getUTCHours();
          const metrics = [0, 8, 16].includes(hour) ? await syncMetrics(env) : null;

          await recordJobRun(
            env,
            "reconcile",
            "success",
            { requeued, ...reconciled, metrics, deadMan },
            startedAt,
          );
        } catch (err) {
          await recordJobRun(
            env,
            "reconcile",
            "failed",
            { error: err instanceof Error ? err.message : String(err) },
            startedAt,
          );
        }
      })(),
    );
  },

  /**
   * Consumer Queue — di sinilah video benar-benar disalin ke Zernio.
   *
   * `max_batch_size: 1` di wrangler.jsonc, jadi tiap invocation menangani satu
   * video dan punya 15 menit wall time untuknya sendiri. Membatch beberapa
   * video memperbesar peluang beberapa upload besar kehabisan waktu bersamaan.
   */
  async queue(batch: MessageBatch<DispatchMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const outcome = await dispatchPost(env, message.body.postId);

        // Kegagalan yang TIDAK pantas diulang di-ack, bukan di-retry (PRD F6).
        // Kunci dicabut atau metadata ditolak tidak akan sembuh dengan tiga
        // percobaan tambahan — itu hanya menunda alert yang justru dibutuhkan,
        // dan barisnya sudah ditandai `failed` berikut sebabnya.
        if (outcome.ok || !outcome.retryable) {
          message.ack();
        } else {
          message.retry();
        }
      } catch (err) {
        console.error(`dispatch ${message.body.postId} gagal:`, err);
        // Lemparan tak terduga selalu layak diulang: penyebabnya belum
        // terklasifikasi, jadi asumsi paling aman adalah sementara.
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, DispatchMessage>;
