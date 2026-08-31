/**
 * Skema D1 — implementasi langsung PRD §9.
 *
 * Konvensi yang dipegang seluruh file ini:
 *   - Semua datetime disimpan sebagai UTC ISO string (TEXT), bukan angka.
 *     SQLite tidak punya tipe tanggal; menyimpan ISO membuat baris tetap bisa
 *     dibaca manusia lewat `d1 execute` saat menelusuri masalah.
 *   - Enum status = TEXT + CHECK constraint. D1 menegakkannya di level
 *     database, jadi bug di kode tidak bisa menulis status yang tidak ada.
 *   - Video TIDAK disimpan di D1 — hanya referensi `r2_key`.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  // PBKDF2 (Web Crypto). bcrypt tidak tersedia di Workers tanpa WASM.
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    status: text("status").notNull().default("active"),

    // Storage
    r2Prefix: text("r2_prefix").notNull(),

    // Kredensial Zernio — TERENKRIPSI at rest (AES-GCM, key dari Wrangler
    // secret). Kolom ini tidak boleh pernah dikembalikan lewat API.
    zernioApiKeyEnc: text("zernio_api_key_enc"),
    zernioAccountId: text("zernio_account_id"),

    // Konten & bahasa
    targetMarket: text("target_market"),
    niche: text("niche"),
    contentType: text("content_type"),
    contentLang: text("content_lang"),

    // Penjadwalan
    timezone: text("timezone").notNull().default("Asia/Jakarta"),
    videosPerDay: integer("videos_per_day").notNull().default(1),
    windowStart: text("window_start").notNull().default("08:00"),
    windowEnd: text("window_end").notNull().default("21:00"),
    intervalMin: integer("interval_min").notNull().default(180),
    activeDays: text("active_days").notNull().default("1,2,3,4,5,6,7"),
    maxUploadsPerDay: integer("max_uploads_per_day").notNull().default(3),

    // Default YouTube
    ytVisibility: text("yt_visibility").notNull().default("public"),
    ytCategory: text("yt_category").notNull().default("22"),
    ytMadeForKids: integer("yt_made_for_kids", { mode: "boolean" }).notNull().default(false),
    ytPlaylistId: text("yt_playlist_id"),
    baselineTags: text("baseline_tags"),

    // AI
    aiTone: text("ai_tone"),
    aiOutputLang: text("ai_output_lang"),
    aiFewShot: text("ai_few_shot"),
    aiCtaTemplate: text("ai_cta_template"),

    // Warm-up (§7.3 grup 8) — dihitung dari tanggal mulai channel itu sendiri,
    // supaya channel yang ditambahkan bulan depan menghangat dari nol dan tidak
    // mewarisi kadensi channel lama.
    warmupEnabled: integer("warmup_enabled", { mode: "boolean" }).notNull().default(true),
    warmupDays: integer("warmup_days").notNull().default(30),
    warmupStartPerDay: integer("warmup_start_per_day").notNull().default(1),
    warmupStartedAt: text("warmup_started_at"),

    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),

    // "YYYY-MM-DD" di timezone channel. Guard bangun-dua-kali sehari.
    lastBuiltDate: text("last_built_date"),

    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [check("channels_status", sql`${t.status} IN ('active','paused')`)],
);

export const videoAssets = sqliteTable(
  "video_assets",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id),
    r2Key: text("r2_key").notNull().unique(),
    durationSec: integer("duration_sec"),
    sizeBytes: integer("size_bytes"),
    mime: text("mime"),
    brief: text("brief"),
    contentType: text("content_type"),
    market: text("market"),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    check(
      "video_assets_status",
      sql`${t.status} IN ('draft','queued','scheduled','published','failed','cancelled')`,
    ),
    // Query terpanas: "video mana yang siap dijadwalkan untuk channel ini".
    index("video_assets_channel_status").on(t.channelId, t.status),
  ],
);

/** Hasil AI — 1:1 dengan video_assets. */
export const videoMetadata = sqliteTable("video_metadata", {
  id: text("id").primaryKey(),
  videoId: text("video_id")
    .notNull()
    .unique()
    .references(() => videoAssets.id, { onDelete: "cascade" }),
  titleSelected: text("title_selected"),
  titlesJson: text("titles_json"),
  description: text("description"),
  tagsJson: text("tags_json"),
  firstComment: text("first_comment"),
  thumbnailText: text("thumbnail_text"),
  thumbnailR2Key: text("thumbnail_r2_key"),
  // 'pass' | 'fail' | 'review' — hasil layer validasi F3.
  validationStatus: text("validation_status"),
  validationJson: text("validation_json"),
  regenerateCount: integer("regenerate_count").notNull().default(0),
  generatedAt: text("generated_at").notNull().default(now),
});

export const scheduledPosts = sqliteTable(
  "scheduled_posts",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => videoAssets.id),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id),
    slotTimeUtc: text("slot_time_utc").notNull(),
    zernioPostId: text("zernio_post_id"),
    // channelId + videoId + slotTime. UNIQUE supaya dua proses yang berlomba
    // tidak bisa membuat post kembar — ditegakkan database, bukan kode.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("scheduled"),
    failReason: text("fail_reason"),
    retryCount: integer("retry_count").notNull().default(0),
    // Dipisah dari slot_time_utc: yang satu kapan KITA menyerahkan ke Zernio,
    // yang lain kapan Zernio benar-benar menerbitkannya. Tanpa keduanya tidak
    // ada cara tahu apakah jitter jadwal selamat melewati hand-off.
    dispatchedAt: text("dispatched_at"),
    publishedAt: text("published_at"),
    // Post yang dibuat saat dry-run: tercatat lengkap, tapi tidak pernah
    // dikirim ke Zernio.
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    check(
      "scheduled_posts_status",
      sql`${t.status} IN ('queued','dispatching','scheduled','published','failed','cancelled')`,
    ),
    index("scheduled_posts_status_slot").on(t.status, t.slotTimeUtc),
    index("scheduled_posts_channel_slot").on(t.channelId, t.slotTimeUtc),
  ],
);

/**
 * Deret waktu, append-only. Satu baris per (post, hari) — bukan satu baris
 * "terbaru" — karena angka mentah tidak bisa meranking video: post 3 hari
 * selalu mengalahkan post 3 jam. Perbandingan adil butuh angka pada UMUR yang
 * sama, dan itu hanya bisa dari riwayat. Riwayat tidak bisa di-backfill.
 */
export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: text("id").primaryKey(),
    scheduledPostId: text("scheduled_post_id")
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: "cascade" }),
    capturedOn: text("captured_on").notNull(),
    capturedAt: text("captured_at").notNull().default(now),
    // Kapan PROVIDER terakhir menyegarkan angkanya, bukan kapan kita menarik.
    // Tanpa ini, metrik basi tidak bisa dibedakan dari metrik yang memang datar.
    providerUpdatedAt: text("provider_updated_at"),
    views: integer("views"),
    watchTimeSec: integer("watch_time_sec"),
    likes: integer("likes"),
    comments: integer("comments"),
    subsGained: integer("subs_gained"),
    rawJson: text("raw_json"),
  },
  (t) => [uniqueIndex("metric_snapshots_post_day").on(t.scheduledPostId, t.capturedOn)],
);

export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull().default(now),
    finishedAt: text("finished_at"),
    detailJson: text("detail_json"),
  },
  (t) => [
    check("job_runs_status", sql`${t.status} IN ('running','success','partial','failed')`),
    index("job_runs_type_started").on(t.jobType, t.startedAt),
  ],
);

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  eventType: text("event_type"),
  payloadJson: text("payload_json"),
  receivedAt: text("received_at").notNull().default(now),
});

/** Preferensi global operator (§7.8). Satu baris, id tetap 'default'. */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("default"),
  // PRD §4: dry-run aktif secara default. Ditegakkan di server, bukan hanya UI.
  dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
  aiOutputLang: text("ai_output_lang").notNull().default("Bahasa Indonesia"),
  aiTone: text("ai_tone").notNull().default("Conversational & Friendly"),
  aiPromptTemplate: text("ai_prompt_template"),
  notifyOnFailure: integer("notify_on_failure", { mode: "boolean" }).notNull().default(true),
  notifyOnPublish: integer("notify_on_publish", { mode: "boolean" }).notNull().default(false),
  notifyOnCronMiss: integer("notify_on_cron_miss", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(now),
});

export type User = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type VideoAsset = typeof videoAssets.$inferSelect;
export type VideoMetadata = typeof videoMetadata.$inferSelect;
export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type Settings = typeof settings.$inferSelect;
