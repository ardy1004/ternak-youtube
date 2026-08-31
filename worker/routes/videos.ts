/**
 * Ingestion video (F2) — upload langsung client→R2, Worker hanya menandatangani.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { channels, videoAssets, videoMetadata } from "../db/schema";
import { UNVERIFIED_MAX_DURATION_SEC } from "../lib/constants";
import type { SessionData } from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const videoRoutes = new Hono<Vars>();

/** Bentuk yang dikonsumsi ContentLibrary.tsx dan UploadFlow.tsx. */
interface VideoDTO {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string;
  type: string;
  market: string;
  status: string;
  brief: string;
  tags: string[];
  description: string;
  titleVariants: string[];
  createdAt: string;
  durationSec: number;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function toDTO(
  video: typeof videoAssets.$inferSelect,
  meta: typeof videoMetadata.$inferSelect | null,
): VideoDTO {
  return {
    id: video.id,
    channelId: video.channelId,
    title: meta?.titleSelected ?? "(belum ada judul)",
    // Thumbnail belum dibangun (Open Questions §12) — kosong lebih jujur
    // daripada placeholder yang terlihat seperti gambar sungguhan.
    thumbnail: "",
    type: video.contentType ?? "",
    market: video.market ?? "",
    status: video.status,
    brief: video.brief ?? "",
    tags: parseJsonArray(meta?.tagsJson ?? null),
    description: meta?.description ?? "",
    titleVariants: parseJsonArray(meta?.titlesJson ?? null),
    createdAt: video.createdAt,
    durationSec: video.durationSec ?? 0,
  };
}

videoRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ video: videoAssets, meta: videoMetadata })
    .from(videoAssets)
    .leftJoin(videoMetadata, eq(videoMetadata.videoId, videoAssets.id))
    .orderBy(desc(videoAssets.createdAt));
  return c.json({ videos: rows.map((r) => toDTO(r.video, r.meta)) });
});

/**
 * Upload multipart lewat binding R2 — BUKAN URL presigned.
 *
 * PRD awalnya menetapkan presigned direct upload (client→R2). Itu ditinggalkan
 * karena tiga alasan yang baru terlihat saat dibangun:
 *
 *  1. URL presigned menunjuk ke R2 sungguhan, jadi `wrangler dev` harus memakai
 *     binding `remote: true` — dan itu menuntut subdomain workers.dev yang akun
 *     ini belum punya. Jalur dev dan produksi jadi berbeda, artinya yang diuji
 *     bukan yang dijalankan.
 *  2. Upload langsung dari browser ke R2 butuh aturan CORS di bucket. Multipart
 *     lewat Worker satu origin, jadi tidak ada CORS sama sekali.
 *  3. Presign butuh kredensial S3 R2 sebagai secret. Binding tidak.
 *
 * Batas 100 MB request body tidak mengikat: yang dikirim per permintaan adalah
 * satu part (~10 MB), bukan seluruh video. Memori 128 MB juga aman karena part
 * dialirkan ke R2, tidak dikumpulkan.
 *
 * Key ditentukan SERVER, bukan klien: nama file dari klien tidak boleh
 * menentukan letak objek, atau siapa pun yang login bisa menulis ke prefix
 * channel lain (atau keluar dari prefix lewat "../").
 */
videoRoutes.post("/upload/start", async (c) => {
  const body = await c.req
    .json<{ channelId?: string; filename?: string; contentType?: string }>()
    .catch(() => null);

  const channelId = body?.channelId;
  if (!channelId) return c.json({ error: "channelId wajib diisi." }, 400);

  const db = drizzle(c.env.DB);
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: "Channel tidak ditemukan." }, 404);

  // Ekstensi diambil dari nama file klien tapi disaring ketat — hanya huruf
  // dan angka, maksimal 5 karakter. Sisanya dibuang.
  const rawExt = (body?.filename ?? "").split(".").pop() ?? "";
  const ext = /^[a-zA-Z0-9]{1,5}$/.test(rawExt) ? rawExt.toLowerCase() : "mp4";
  const contentType = (body?.contentType ?? "video/mp4").split(";")[0]?.trim() || "video/mp4";

  const videoId = `vid_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const key = `${channel.r2Prefix}${videoId}.${ext}`;

  const upload = await c.env.VIDEOS.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });

  return c.json({ videoId, key, uploadId: upload.uploadId, contentType });
});

/**
 * Menerima satu part. Body permintaan ini ADALAH byte part-nya.
 *
 * R2 mensyaratkan setiap part kecuali yang terakhir minimal 5 MB; klien yang
 * mengatur pemotongannya (lihat src/lib/upload.ts).
 */
videoRoutes.put("/upload/part", async (c) => {
  const key = c.req.query("key");
  const uploadId = c.req.query("uploadId");
  const partNumber = Number(c.req.query("partNumber"));

  if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return c.json({ error: "key, uploadId, dan partNumber wajib diisi." }, 400);
  }
  if (!c.req.raw.body) return c.json({ error: "Body part kosong." }, 400);

  const upload = c.env.VIDEOS.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, c.req.raw.body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

videoRoutes.post("/upload/abort", async (c) => {
  const body = await c.req.json<{ key?: string; uploadId?: string }>().catch(() => null);
  if (!body?.key || !body?.uploadId) return c.json({ error: "key dan uploadId wajib." }, 400);
  await c.env.VIDEOS.resumeMultipartUpload(body.key, body.uploadId).abort();
  return c.json({ ok: true });
});

/**
 * Mencatat video setelah byte-nya benar-benar ada di R2.
 *
 * Keberadaan objek diverifikasi lewat binding R2, bukan dipercaya dari klien:
 * baris yang menunjuk ke objek yang tidak ada akan gagal jauh di kemudian hari,
 * di dalam cron, saat penyebabnya sudah sulit dilacak.
 */
videoRoutes.post("/upload/complete", async (c) => {
  const body = await c.req
    .json<{
      videoId?: string;
      channelId?: string;
      key?: string;
      uploadId?: string;
      parts?: Array<{ partNumber: number; etag: string }>;
      brief?: string;
      contentType?: string;
      market?: string;
      durationSec?: number;
      mime?: string;
    }>()
    .catch(() => null);

  const { videoId, channelId, key, uploadId, parts } = body ?? {};
  if (!videoId || !channelId || !key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "videoId, channelId, key, uploadId, dan parts wajib diisi." }, 400);
  }

  const db = drizzle(c.env.DB);
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: "Channel tidak ditemukan." }, 404);

  if (!key.startsWith(channel.r2Prefix)) {
    return c.json({ error: "Key tidak berada di prefix channel ini." }, 400);
  }

  const upload = c.env.VIDEOS.resumeMultipartUpload(key, uploadId);
  let object: R2Object;
  try {
    // Part harus urut nomor; R2 menolak daftar yang tidak terurut.
    object = await upload.complete([...parts].sort((a, b) => a.partNumber - b.partNumber));
  } catch (err) {
    return c.json(
      { error: `Gagal menyelesaikan upload: ${err instanceof Error ? err.message : String(err)}` },
      400,
    );
  }

  const durationSec = body?.durationSec ?? 0;
  if (durationSec > UNVERIFIED_MAX_DURATION_SEC && !channel.isVerified) {
    // Dicegah di sini, bukan saat publish: kegagalan saat publish berarti slot
    // hari itu hangus, dan operator baru tahu keesokan harinya.
    await c.env.VIDEOS.delete(key);
    return c.json(
      {
        error: `Video ${Math.round(durationSec / 60)} menit butuh channel terverifikasi. Objek dihapus dari R2.`,
      },
      400,
    );
  }

  await db.insert(videoAssets).values({
    id: videoId,
    channelId,
    r2Key: key,
    durationSec,
    sizeBytes: object.size,
    mime: body?.mime ?? object.httpMetadata?.contentType ?? "video/mp4",
    brief: body?.brief ?? "",
    contentType: body?.contentType ?? "",
    market: body?.market ?? "",
    status: "draft",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const [created] = await db.select().from(videoAssets).where(eq(videoAssets.id, videoId)).limit(1);
  return c.json({ video: toDTO(created!, null) }, 201);
});

videoRoutes.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [video] = await db.select().from(videoAssets).where(eq(videoAssets.id, id)).limit(1);
  if (!video) return c.json({ error: "Video tidak ditemukan." }, 404);

  // R2 dulu, baru baris. Urutan sebaliknya bisa meninggalkan objek yatim yang
  // tidak ada lagi yang merujuknya — dan tidak ada yang akan menghapusnya.
  await c.env.VIDEOS.delete(video.r2Key);
  await db.delete(videoAssets).where(eq(videoAssets.id, id));
  return c.json({ ok: true });
});
