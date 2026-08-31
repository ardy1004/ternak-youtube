/**
 * Layer validasi F3 — pertahanan terakhir sebelum metadata dikirim ke YouTube.
 *
 * Ini BUKAN duplikasi dari `responseSchema` Gemini. Schema menjamin bentuk
 * (field ada, tipenya benar); layer ini menjamin isi memenuhi batas YouTube dan
 * kebijakan channel. Model bisa saja mengembalikan judul 140 karakter yang
 * sempurna secara skema — dan YouTube akan menolaknya.
 */
import {
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_TAGS_TOTAL_MAX,
  YOUTUBE_TITLE_MAX,
} from "./constants";

export interface MetadataDraft {
  titles: string[];
  description: string;
  tags: string[];
  firstComment: string;
  thumbnailText: string;
}

export interface CheckResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface ValidationResult {
  pass: boolean;
  checks: CheckResult[];
}

/**
 * YouTube menolak judul yang memuat `<` atau `>` mentah-mentah, dan caption
 * hasil generator adalah teks bebas. Bersihkan daripada membiarkan seluruh post
 * dipantulkan karena karakter yang tidak seorang pun pilih dengan sengaja.
 */
export function sanitizeTitle(raw: string): string {
  return raw.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

export function sanitizeTag(raw: string): string {
  return raw.replace(/[<>,]/g, "").replace(/\s+/g, " ").trim();
}

/** Kata yang membuat video ditandai atau dibatasi. Konservatif dan bisa diperluas. */
const BANNED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(gratis|free)\s+(iphone|hadiah|giveaway)\b/i, label: "umpan giveaway" },
  { pattern: /\bklik\s+di\s+sini\s+sekarang\b/i, label: "clickbait eksplisit" },
  { pattern: /\bsubscribe\s+atau\b/i, label: "paksaan subscribe" },
  { pattern: /\b(judi|slot\s*gacor|togel)\b/i, label: "konten judi" },
];

export function validateMetadata(draft: MetadataDraft): ValidationResult {
  const checks: CheckResult[] = [];

  const title = draft.titles[0] ?? "";
  checks.push({
    id: "title-length",
    label: "Panjang judul",
    pass: title.length > 0 && title.length <= YOUTUBE_TITLE_MAX,
    detail:
      title.length === 0
        ? "Judul kosong."
        : `${title.length} / ${YOUTUBE_TITLE_MAX} karakter`,
  });

  checks.push({
    id: "title-chars",
    label: "Karakter judul",
    pass: !/[<>\n\r]/.test(title),
    detail: /[<>\n\r]/.test(title)
      ? "Mengandung < > atau baris baru — ditolak YouTube."
      : "Tidak ada karakter terlarang.",
  });

  checks.push({
    id: "description-length",
    label: "Panjang deskripsi",
    pass: draft.description.length <= YOUTUBE_DESCRIPTION_MAX,
    detail: `${draft.description.length} / ${YOUTUBE_DESCRIPTION_MAX} karakter`,
  });

  // YouTube membatasi TOTAL panjang seluruh tag, bukan jumlah tag-nya —
  // memvalidasi jumlah saja akan lolos di sini lalu ditolak di sana.
  const tagsTotal = draft.tags.join(",").length;
  checks.push({
    id: "tags-total",
    label: "Total panjang tag",
    pass: tagsTotal <= YOUTUBE_TAGS_TOTAL_MAX,
    detail: `${tagsTotal} / ${YOUTUBE_TAGS_TOTAL_MAX} karakter (${draft.tags.length} tag)`,
  });

  const haystack = [title, draft.description, ...draft.tags, draft.firstComment]
    .join(" ")
    .toLowerCase();
  const hit = BANNED_PATTERNS.find((b) => b.pattern.test(haystack));
  checks.push({
    id: "banned-words",
    label: "Kata terlarang",
    pass: !hit,
    detail: hit ? `Terdeteksi: ${hit.label}` : "Bersih.",
  });

  checks.push({
    id: "variants",
    label: "Varian judul",
    pass: draft.titles.length >= 3,
    detail: `${draft.titles.length} varian (minimal 3)`,
  });

  return { pass: checks.every((c) => c.pass), checks };
}
