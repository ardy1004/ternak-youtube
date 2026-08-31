/**
 * Provider metadata AI.
 *
 * Dibungkus interface `MetadataProvider` (PRD §10) supaya model bisa diganti
 * tanpa menyentuh pipeline — sama seperti SchedulerProvider untuk Zernio.
 */
import type { MetadataDraft } from "./validation";
import { sanitizeTag, sanitizeTitle } from "./validation";
import { YOUTUBE_TITLE_MAX } from "./constants";

export interface GenerateContext {
  brief: string;
  contentType: string;
  market: string;
  contentLang: string;
  tone: string;
  outputLang: string;
  fewShot: string;
  ctaTemplate: string;
  baselineTags: string;
  promptTemplate: string;
}

export interface MetadataProvider {
  generate(ctx: GenerateContext): Promise<MetadataDraft>;
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Rantai model, dicoba berurutan.
 *
 * Ada rantai, bukan satu nama, karena Google MENARIK model dari pengguna baru
 * tanpa peringatan: `gemini-2.5-flash` yang semula ditetapkan PRD menjawab 404
 * "no longer available to new users" saat fitur ini dibangun — padahal endpoint
 * ListModels MASIH mencantumkannya. Jadi daftar model pun tidak bisa dipercaya;
 * hanya panggilan sungguhan yang membuktikan.
 *
 * 404/400 berarti model itu tidak ada untuk kita → lanjut ke berikutnya.
 * 503 berarti sedang padat → juga lanjut, karena alias `-latest` kerap penuh.
 * Error lain (401, 429 kuota) dilempar apa adanya: berpindah model tidak akan
 * memperbaikinya dan hanya menyamarkan penyebabnya.
 */
const MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-flash-latest"];

/**
 * Skema ditegakkan di sisi model lewat `responseSchema`, bukan hanya diminta
 * lewat prompt. Model yang diminta "balas JSON" tetap kadang membungkusnya
 * dengan ```json atau menambahi kalimat pengantar; dengan responseSchema, yang
 * kembali dijamin JSON yang cocok bentuknya.
 *
 * `propertyOrdering` disertakan karena Gemini menghormatinya dan output yang
 * urutannya stabil lebih mudah dibandingkan antar-generasi.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: { type: "string", maxLength: YOUTUBE_TITLE_MAX },
      minItems: 3,
      maxItems: 3,
    },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 15 },
    firstComment: { type: "string" },
    thumbnailText: { type: "string", maxLength: 30 },
  },
  required: ["titles", "description", "tags", "firstComment", "thumbnailText"],
  propertyOrdering: ["titles", "description", "tags", "firstComment", "thumbnailText"],
};

function buildPrompt(ctx: GenerateContext): string {
  const filled = ctx.promptTemplate
    .replace(/\{\{contentType\}\}/g, ctx.contentType || "umum")
    .replace(/\{\{market\}\}/g, ctx.market || "Indonesia")
    .replace(/\{\{tone\}\}/g, ctx.tone || "netral")
    .replace(/\{\{lang\}\}/g, ctx.outputLang || "Bahasa Indonesia");

  const parts = [
    filled,
    "",
    `Brief video: ${ctx.brief}`,
    `Bahasa output: ${ctx.outputLang || "Bahasa Indonesia"}`,
    `Nada: ${ctx.tone || "netral"}`,
    `Target pasar: ${ctx.market || "Indonesia"}`,
  ];

  if (ctx.fewShot.trim()) {
    parts.push("", "Contoh gaya judul dari channel ini (tiru gayanya, jangan salin isinya):", ctx.fewShot.trim());
  }
  if (ctx.baselineTags.trim()) {
    parts.push("", `Sertakan tag dasar ini bila relevan: ${ctx.baselineTags.trim()}`);
  }
  if (ctx.ctaTemplate.trim()) {
    parts.push("", `Akhiri deskripsi dengan CTA berikut: ${ctx.ctaTemplate.trim()}`);
  }

  parts.push(
    "",
    `Batas keras: setiap judul maksimal ${YOUTUBE_TITLE_MAX} karakter, tanpa < atau >, tanpa baris baru.`,
  );

  return parts.join("\n");
}

export function createGeminiProvider(apiKey: string): MetadataProvider {
  return {
    async generate(ctx: GenerateContext): Promise<MetadataDraft> {
      const payload = JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(ctx) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.9,
        },
      });

      let text: string | undefined;
      const tried: string[] = [];

      for (const model of MODEL_CHAIN) {
        const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: payload,
        });

        if (res.ok) {
          const json = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          break;
        }

        const detail = await res.text().catch(() => "");
        tried.push(`${model} → HTTP ${res.status}`);

        // Hanya "model ini tidak bisa dipakai" yang layak dicoba ke model lain.
        if (![400, 404, 503].includes(res.status)) {
          throw new Error(`Gemini menolak permintaan (HTTP ${res.status}): ${detail.slice(0, 300)}`);
        }
      }

      if (!text) {
        throw new Error(
          `Tidak ada model Gemini yang bisa dipakai. Dicoba: ${tried.join(", ") || "(tidak ada)"}.`,
        );
      }

      let parsed: Partial<MetadataDraft>;
      try {
        parsed = JSON.parse(text) as Partial<MetadataDraft>;
      } catch {
        throw new Error("Gemini mengembalikan teks yang bukan JSON.");
      }

      // Sanitasi SEBELUM validasi: kalau model menyisipkan < atau > yang bisa
      // dibuang tanpa mengubah makna, lebih baik dibersihkan daripada memaksa
      // satu putaran regenerate yang menghabiskan jatah operator.
      return {
        titles: (parsed.titles ?? []).map(sanitizeTitle).filter(Boolean),
        description: (parsed.description ?? "").trim(),
        tags: (parsed.tags ?? []).map(sanitizeTag).filter(Boolean),
        firstComment: (parsed.firstComment ?? "").trim(),
        thumbnailText: (parsed.thumbnailText ?? "").trim(),
      };
    },
  };
}
