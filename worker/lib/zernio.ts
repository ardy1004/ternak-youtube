/**
 * Klien Zernio.
 *
 * Setiap aturan di file ini dibayar mahal — sebagian oleh spike kita sendiri
 * (§12 PRD), sebagian oleh insiden nyata di sistem penjadwal yang sudah jalan
 * di produksi. Jangan ubah bentuk payload di sini tanpa menguji ulang ke akun
 * sungguhan; kesalahan di jalur tulis TIDAK muncul sebagai error, ia muncul
 * sebagai post yang diam-diam tidak pernah terbit.
 */
const BASE = "https://zernio.com/api/v1";

export interface ZernioAccount {
  _id: string;
  platform: string;
  displayName?: string;
  username?: string;
  isActive?: boolean;
}

export interface ZernioResponse<T> {
  ok: boolean;
  status: number;
  json: T | null;
  text: string;
}

async function call<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ZernioResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json: T | null = null;
  try {
    json = JSON.parse(text) as T;
  } catch {
    /* biarkan mentah */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Daftar akun terhubung. Dipakai tombol "Test connection" — satu-satunya
 * panggilan read-only yang membuktikan kunci itu sah SEKALIGUS channel-nya
 * benar-benar tersambung.
 */
export async function listAccounts(apiKey: string): Promise<ZernioResponse<{ accounts?: ZernioAccount[] }>> {
  return call<{ accounts?: ZernioAccount[] }>(apiKey, "GET", "/accounts");
}

/** Bentuk respons /accounts tidak konsisten antar versi; rangkul keduanya. */
export function extractAccounts(json: unknown): ZernioAccount[] {
  if (!json) return [];
  if (Array.isArray(json)) return json as ZernioAccount[];
  const record = json as Record<string, unknown>;
  for (const key of ["accounts", "data", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as ZernioAccount[];
  }
  return [];
}

/**
 * Unggah media ke storage Zernio.
 *
 * Zernio TIDAK menarik dari URL eksternal saat publish — dibuktikan spike:
 * URL presigned R2 yang mati sebelum jam tayang menghasilkan
 * `"Failed to fetch video source: 403"`. Jadi bytes harus disalin ke sini.
 *
 * `body` sengaja bertipe ReadableStream, bukan ArrayBuffer: isolate Worker
 * dibatasi 128 MB, dan membaca video utuh ke memori akan OOM. Streaming dengan
 * Content-Length sudah diverifikasi diterima (SHA-256 cocok byte per byte).
 */
export async function uploadMedia(
  apiKey: string,
  opts: { filename: string; contentType: string; size: number; body: ReadableStream },
): Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }> {
  // MIME harus polos. Cloudinary mengirim "video/mp4;codecs=avc1" dan enum
  // validator Zernio menolaknya mentah-mentah — akar penyebab "presign gagal
  // (400)" di sistem referensi.
  const contentType = opts.contentType.split(";")[0]?.trim() || "video/mp4";

  const presign = await call<{ uploadUrl?: string; publicUrl?: string }>(
    apiKey,
    "POST",
    "/media/presign",
    { filename: opts.filename, contentType },
  );
  if (!presign.ok || !presign.json?.uploadUrl || !presign.json?.publicUrl) {
    return {
      ok: false,
      error: `Presign gagal (HTTP ${presign.status}): ${presign.text.slice(0, 300)}`,
    };
  }

  const put = await fetch(presign.json.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(opts.size) },
    body: opts.body,
    // Wajib saat body berupa stream.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!put.ok) {
    const detail = await put.text().catch(() => "");
    return { ok: false, error: `Upload gagal (HTTP ${put.status}): ${detail.slice(0, 300)}` };
  }

  return { ok: true, publicUrl: presign.json.publicUrl };
}

export interface CreatePostInput {
  accountId: string;
  mediaUrl: string;
  /** Deskripsi video. YouTube tidak punya field deskripsi terpisah di Zernio. */
  content: string;
  title: string;
  visibility: string;
  categoryId: string;
  madeForKids: boolean;
  /** ISO tanpa sufiks zona, mis. "2026-09-02T19:30:00". */
  scheduledFor: string;
  timezone: string;
}

export interface CreatePostResult {
  ok: boolean;
  postId?: string;
  status?: string;
  error?: string;
}

const DEAD_STATUSES = new Set(["draft", "failed"]);

/**
 * Membuat satu post terjadwal.
 *
 * Empat aturan yang tidak boleh dilanggar:
 *  1. Field jadwalnya `scheduledFor` + `timezone`. BUKAN `scheduledAt` — nama
 *     itu tidak dikenal Zernio, dan tanpa `scheduledFor` maupun `publishNow`
 *     post disimpan sebagai draft yang tidak akan pernah terbit. Ini yang
 *     membuat Threads + Facebook Page diam 13 hari dengan 196 draft.
 *  2. `platformSpecificData` BERSARANG di dalam entri platform. Di level atas
 *     ia diabaikan diam-diam — dan video terbit dengan visibility default
 *     YouTube, yaitu publik.
 *  3. HTTP 200 BUKAN bukti sukses. Zernio menjawab 200 untuk draft juga.
 *  4. Post yang dibuat terbungkus `{ post: { _id } }`. Membaca `json.id`
 *     menyimpan undefined.
 */
export async function createPost(
  apiKey: string,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const res = await call<Record<string, unknown>>(apiKey, "POST", "/posts", {
    content: input.content,
    mediaItems: [{ type: "video", url: input.mediaUrl }],
    platforms: [
      {
        platform: "youtube",
        accountId: input.accountId,
        platformSpecificData: {
          title: input.title,
          visibility: input.visibility,
          madeForKids: input.madeForKids,
          categoryId: input.categoryId,
        },
      },
    ],
    scheduledFor: input.scheduledFor,
    timezone: input.timezone,
  });

  if (!res.ok) {
    const message =
      (res.json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    return { ok: false, error: message };
  }

  const created = unwrapPost(res.json);
  const postId = readPostId(created);
  const status = typeof created?.status === "string" ? created.status : undefined;

  if (status && DEAD_STATUSES.has(status)) {
    return {
      ok: false,
      postId,
      status,
      error: `Zernio menyimpan post sebagai "${status}" — tidak akan pernah terbit. Periksa scheduledFor/timezone.`,
    };
  }

  return { ok: true, postId, status };
}

export async function getPost(apiKey: string, postId: string) {
  return call<Record<string, unknown>>(apiKey, "GET", `/posts/${postId}`);
}

export async function deletePost(apiKey: string, postId: string) {
  return call<Record<string, unknown>>(apiKey, "DELETE", `/posts/${postId}`);
}

/** Post yang dibuat dibungkus `post`/`data`; yang dibaca kembali kadang tidak. */
export function unwrapPost(json: unknown): Record<string, unknown> | undefined {
  if (!json || typeof json !== "object") return undefined;
  const record = json as Record<string, unknown>;
  for (const key of ["post", "data"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return record;
}

/** Id post muncul sebagai `_id`, `id`, atau `postId` tergantung endpoint. */
export function readPostId(source: unknown): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  for (const key of ["_id", "id", "postId"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/**
 * Status paling spesifik untuk post yang kita buat.
 *
 * Satu post kita selalu menyasar tepat satu platform, jadi entri per-platform
 * lebih akurat daripada rollup di level post — dan itu yang memuat pesan error
 * sebenarnya.
 */
export function readPostStatus(post: Record<string, unknown> | undefined): {
  status: string;
  error?: string;
  publishedAt?: string;
} {
  if (!post) return { status: "unknown" };
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  const entry = platforms[0] as Record<string, unknown> | undefined;

  const platformStatus = typeof entry?.status === "string" ? entry.status : undefined;
  const status =
    platformStatus && platformStatus !== "pending"
      ? platformStatus
      : String(post.status ?? "unknown");

  const error =
    (typeof entry?.errorMessage === "string" ? entry.errorMessage : undefined) ??
    (typeof post.error === "string" ? post.error : undefined);

  const publishedAt = typeof post.publishedAt === "string" ? post.publishedAt : undefined;

  return { status, error, publishedAt };
}
