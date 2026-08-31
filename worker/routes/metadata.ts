/**
 * F3 — generate metadata AI + layer validasi.
 *
 * Aturan PRD yang ditegakkan di sini, bukan di UI: gagal validasi → boleh
 * regenerate SATU kali → kalau masih gagal, video masuk review queue sebagai
 * `draft`, bahkan dalam mode full-auto. Kalau aturan ini hidup di klien, ia
 * bisa dilewati hanya dengan memanggil endpoint langsung.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { channels, settings, videoAssets, videoMetadata } from "../db/schema";
import { createGeminiProvider } from "../lib/gemini";
import { validateMetadata } from "../lib/validation";
import type { SessionData } from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const metadataRoutes = new Hono<Vars>();

const MAX_REGENERATE = 1;

const DEFAULT_PROMPT =
  "Tulis metadata YouTube untuk video {{contentType}} yang menyasar pasar {{market}}. " +
  "Gunakan nada {{tone}} dalam {{lang}}. Kembalikan 3 varian judul, deskripsi, tag, komentar pertama, dan teks thumbnail.";

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

metadataRoutes.post("/:videoId/generate", async (c) => {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "GEMINI_API_KEY belum diset di Worker." }, 500);
  }

  const db = drizzle(c.env.DB);
  const videoId = c.req.param("videoId");

  const [video] = await db.select().from(videoAssets).where(eq(videoAssets.id, videoId)).limit(1);
  if (!video) return c.json({ error: "Video tidak ditemukan." }, 404);

  const [channel] = await db.select().from(channels).where(eq(channels.id, video.channelId)).limit(1);
  if (!channel) return c.json({ error: "Channel tidak ditemukan." }, 404);

  const [globalSettings] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  const [existing] = await db
    .select()
    .from(videoMetadata)
    .where(eq(videoMetadata.videoId, videoId))
    .limit(1);

  const attempt = existing?.regenerateCount ?? 0;
  if (attempt > MAX_REGENERATE) {
    return c.json(
      { error: `Jatah regenerate (${MAX_REGENERATE}x) sudah habis untuk video ini.` },
      409,
    );
  }

  const provider = createGeminiProvider(apiKey);
  let draft;
  try {
    draft = await provider.generate({
      brief: video.brief ?? "",
      contentType: video.contentType ?? "",
      market: video.market ?? "",
      contentLang: channel.contentLang ?? "",
      // Setelan channel menang atas setelan global — global hanya nilai jatuh.
      tone: channel.aiTone || globalSettings?.aiTone || "",
      outputLang: channel.aiOutputLang || globalSettings?.aiOutputLang || "",
      fewShot: channel.aiFewShot ?? "",
      ctaTemplate: channel.aiCtaTemplate ?? "",
      baselineTags: channel.baselineTags ?? "",
      promptTemplate: globalSettings?.aiPromptTemplate || DEFAULT_PROMPT,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Gagal memanggil Gemini." }, 502);
  }

  const validation = validateMetadata(draft);

  // Habis jatah DAN masih gagal -> review queue. Ini keputusan yang tidak boleh
  // dibuat klien, jadi status video ikut diubah di sini.
  const exhausted = attempt >= MAX_REGENERATE;
  const validationStatus = validation.pass ? "pass" : exhausted ? "review" : "fail";

  const row = {
    videoId,
    titleSelected: draft.titles[0] ?? "",
    titlesJson: JSON.stringify(draft.titles),
    description: draft.description,
    tagsJson: JSON.stringify(draft.tags),
    firstComment: draft.firstComment,
    thumbnailText: draft.thumbnailText,
    validationStatus,
    validationJson: JSON.stringify(validation.checks),
    regenerateCount: attempt + 1,
    generatedAt: nowIso(),
  };

  if (existing) {
    await db.update(videoMetadata).set(row).where(eq(videoMetadata.videoId, videoId));
  } else {
    await db
      .insert(videoMetadata)
      .values({ id: `meta_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, ...row });
  }

  if (validationStatus === "review") {
    await db
      .update(videoAssets)
      .set({ status: "draft", updatedAt: nowIso() })
      .where(eq(videoAssets.id, videoId));
  }

  return c.json({
    metadata: draft,
    validation,
    validationStatus,
    attemptsUsed: attempt + 1,
    attemptsLeft: Math.max(0, MAX_REGENERATE - attempt),
    sentToReview: validationStatus === "review",
  });
});

/**
 * Konfirmasi metadata → video masuk pool sebagai `queued`.
 *
 * Menolak konfirmasi bila validasi belum lulus: itulah gunanya layer validasi.
 * Operator yang ingin tetap melanjutkan harus memperbaiki metadatanya dulu.
 */
metadataRoutes.post("/:videoId/confirm", async (c) => {
  const db = drizzle(c.env.DB);
  const videoId = c.req.param("videoId");
  const body = await c.req
    .json<{ titleSelected?: string; description?: string; tags?: string[] }>()
    .catch(() => null);

  const [meta] = await db
    .select()
    .from(videoMetadata)
    .where(eq(videoMetadata.videoId, videoId))
    .limit(1);
  if (!meta) return c.json({ error: "Metadata belum digenerate untuk video ini." }, 400);

  // Suntingan manual operator divalidasi ulang — bukan dipercaya begitu saja.
  const draft = {
    titles: body?.titleSelected
      ? [body.titleSelected, ...JSON.parse(meta.titlesJson ?? "[]").slice(1)]
      : (JSON.parse(meta.titlesJson ?? "[]") as string[]),
    description: body?.description ?? meta.description ?? "",
    tags: body?.tags ?? (JSON.parse(meta.tagsJson ?? "[]") as string[]),
    firstComment: meta.firstComment ?? "",
    thumbnailText: meta.thumbnailText ?? "",
  };
  const validation = validateMetadata(draft);
  if (!validation.pass) {
    return c.json(
      { error: "Metadata belum lolos validasi.", validation },
      422,
    );
  }

  await db
    .update(videoMetadata)
    .set({
      titleSelected: draft.titles[0] ?? "",
      titlesJson: JSON.stringify(draft.titles),
      description: draft.description,
      tagsJson: JSON.stringify(draft.tags),
      validationStatus: "pass",
      validationJson: JSON.stringify(validation.checks),
    })
    .where(eq(videoMetadata.videoId, videoId));

  await db
    .update(videoAssets)
    .set({ status: "queued", updatedAt: nowIso() })
    .where(eq(videoAssets.id, videoId));

  return c.json({ ok: true, status: "queued" });
});
