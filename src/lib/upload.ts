import { ApiError } from "./api";

/**
 * Unggah video ke R2 lewat multipart, sepotong demi sepotong.
 *
 * R2 mensyaratkan setiap part kecuali yang TERAKHIR minimal 5 MB. 10 MB dipilih
 * supaya video kecil tetap jadi satu part (cepat), sementara video besar
 * terpecah cukup halus untuk memberi progress yang berarti — dan tiap
 * permintaan tetap jauh di bawah batas body 100 MB.
 */
const PART_SIZE = 10 * 1024 * 1024;

export interface UploadResult {
  videoId: string;
  key: string;
}

export interface UploadOptions {
  file: File;
  channelId: string;
  brief?: string;
  contentType?: string;
  market?: string;
  durationSec?: number;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`);
  return json as T;
}

export async function uploadVideo(opts: UploadOptions): Promise<UploadResult> {
  const { file, channelId, signal } = opts;

  const start = await postJson<{ videoId: string; key: string; uploadId: string }>(
    "/videos/upload/start",
    { channelId, filename: file.name, contentType: file.type || "video/mp4" },
    signal,
  );

  const parts: Array<{ partNumber: number; etag: string }> = [];
  const total = Math.max(1, Math.ceil(file.size / PART_SIZE));

  try {
    for (let i = 0; i < total; i++) {
      const chunk = file.slice(i * PART_SIZE, Math.min((i + 1) * PART_SIZE, file.size));
      const query = new URLSearchParams({
        key: start.key,
        uploadId: start.uploadId,
        partNumber: String(i + 1),
      });

      const res = await fetch(`/api/videos/upload/part?${query}`, {
        method: "PUT",
        credentials: "same-origin",
        body: chunk,
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, `Part ${i + 1} gagal: ${text.slice(0, 200)}`);
      }

      parts.push((await res.json()) as { partNumber: number; etag: string });
      opts.onProgress?.((i + 1) / total);
    }

    await postJson("/videos/upload/complete", {
      videoId: start.videoId,
      channelId,
      key: start.key,
      uploadId: start.uploadId,
      parts,
      brief: opts.brief,
      contentType: opts.contentType,
      market: opts.market,
      durationSec: opts.durationSec,
      mime: file.type || "video/mp4",
    });

    return { videoId: start.videoId, key: start.key };
  } catch (err) {
    // Upload multipart yang ditinggalkan tetap memakan penyimpanan R2 sampai
    // dibatalkan, dan tidak terlihat di listing objek biasa — jadi gampang
    // menumpuk tanpa disadari. Batalkan, tapi jangan tutupi error aslinya.
    void postJson("/videos/upload/abort", { key: start.key, uploadId: start.uploadId }).catch(
      () => {},
    );
    throw err;
  }
}

/**
 * Membaca durasi video di browser, tanpa mengunggahnya dulu.
 *
 * Dipakai untuk menegakkan aturan "video >15 menit butuh channel terverifikasi"
 * SEBELUM byte-nya dikirim — server tetap memeriksa ulang, ini hanya agar
 * operator tidak menunggu upload panjang yang sudah pasti ditolak.
 */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Math.round(video.duration) || 0);
    // Format yang tidak bisa dibaca browser bukan alasan menggagalkan upload —
    // 0 berarti "tidak diketahui", dan server yang memutuskan.
    video.onerror = () => done(0);
    video.src = url;
  });
}
