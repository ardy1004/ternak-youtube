/**
 * Konstanta runtime tinggal di sini, BUKAN di worker/index.ts.
 *
 * workerd memperlakukan setiap named export dari modul entry sebagai handler
 * atau Durable Object. Mengekspor `const` biasa dari sana menjatuhkan Worker
 * saat start dengan "Incorrect type for map entry ...: the provided value is
 * not of type 'function or ExportedHandler'". Tipe aman diekspor dari entry
 * (terhapus saat kompilasi), nilai tidak.
 */

/** Harus cocok dengan `bucket_name` di r2_buckets pada wrangler.jsonc. */
export const R2_BUCKET = "ternak-youtube";

/** Batas YouTube yang ditegakkan layer validasi F3. */
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
export const YOUTUBE_TAGS_TOTAL_MAX = 500;

/** Durasi di atas ini butuh channel terverifikasi (F2). */
export const UNVERIFIED_MAX_DURATION_SEC = 15 * 60;
