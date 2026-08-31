/**
 * CRUD channel + test koneksi (PRD §7.3, F1).
 *
 * API sengaja mengembalikan bentuk yang PERSIS dipakai UI prototipe, bukan
 * bentuk baris database. Pemetaannya dikurung di file ini supaya kesembilan
 * layar tidak perlu diubah sama sekali — itu yang membuat konversi bertahap ini
 * mungkin dikerjakan tanpa membongkar UI yang sudah jadi.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { channels, type Channel as ChannelRow } from "../db/schema";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { extractAccounts, listAccounts } from "../lib/zernio";
import type { SessionData } from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const channelRoutes = new Hono<Vars>();

/** Bentuk yang dikonsumsi src/screens/Channels.tsx dan AddChannel.tsx. */
interface ChannelDTO {
  id: string;
  name: string;
  handle: string;
  status: string;
  market: string;
  niche: string;
  contentType: string;
  contentLang: string;
  timezone: string;
  videosPerDay: number;
  maxUploadsPerDay: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  activeDays: string[];
  visibility: string;
  category: string;
  baselineTags: string;
  playlistId: string;
  madeForKids: boolean;
  aiOutputLang: string;
  aiTone: string;
  aiFewShot: string;
  aiCtaTemplate: string;
  warmupEnabled: boolean;
  warmupDays: number;
  warmupStartPerDay: number;
  weeklyViews: number;
  /** Kunci Zernio TIDAK pernah dikirim — hanya apakah sudah diisi. */
  hasZernioKey: boolean;
  zernioAccountId: string;
}

function toDTO(row: ChannelRow): ChannelDTO {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    status: row.status,
    market: row.targetMarket ?? "",
    niche: row.niche ?? "",
    contentType: row.contentType ?? "",
    contentLang: row.contentLang ?? "",
    timezone: row.timezone,
    videosPerDay: row.videosPerDay,
    maxUploadsPerDay: row.maxUploadsPerDay,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    intervalMin: row.intervalMin,
    activeDays: row.activeDays ? row.activeDays.split(",").filter(Boolean) : [],
    visibility: row.ytVisibility,
    category: row.ytCategory,
    baselineTags: row.baselineTags ?? "",
    playlistId: row.ytPlaylistId ?? "",
    madeForKids: row.ytMadeForKids,
    aiOutputLang: row.aiOutputLang ?? "",
    aiTone: row.aiTone ?? "",
    aiFewShot: row.aiFewShot ?? "",
    aiCtaTemplate: row.aiCtaTemplate ?? "",
    warmupEnabled: row.warmupEnabled,
    warmupDays: row.warmupDays,
    warmupStartPerDay: row.warmupStartPerDay,
    // Terisi dari metric_snapshots di Stage 7. Sampai saat itu 0 adalah
    // jawaban jujur — lebih baik daripada angka karangan yang terlihat nyata.
    weeklyViews: 0,
    hasZernioKey: Boolean(row.zernioApiKeyEnc),
    zernioAccountId: row.zernioAccountId ?? "",
  };
}

type ChannelInput = Partial<ChannelDTO> & { zernioApiKey?: string };

/** Hanya field yang benar-benar dikirim yang ditulis — sisanya tidak disentuh. */
function toRow(input: ChannelInput): Partial<typeof channels.$inferInsert> {
  const row: Partial<typeof channels.$inferInsert> = {};
  const set = <K extends keyof typeof channels.$inferInsert>(
    key: K,
    value: (typeof channels.$inferInsert)[K] | undefined,
  ) => {
    if (value !== undefined) row[key] = value;
  };

  set("name", input.name);
  set("handle", input.handle);
  set("status", input.status);
  set("targetMarket", input.market);
  set("niche", input.niche);
  set("contentType", input.contentType);
  set("contentLang", input.contentLang);
  set("timezone", input.timezone);
  set("videosPerDay", input.videosPerDay);
  set("maxUploadsPerDay", input.maxUploadsPerDay);
  set("windowStart", input.windowStart);
  set("windowEnd", input.windowEnd);
  set("intervalMin", input.intervalMin);
  set("activeDays", input.activeDays ? input.activeDays.join(",") : undefined);
  set("ytVisibility", input.visibility);
  set("ytCategory", input.category);
  set("baselineTags", input.baselineTags);
  set("ytPlaylistId", input.playlistId);
  set("ytMadeForKids", input.madeForKids);
  set("aiOutputLang", input.aiOutputLang);
  set("aiTone", input.aiTone);
  set("aiFewShot", input.aiFewShot);
  set("aiCtaTemplate", input.aiCtaTemplate);
  set("warmupEnabled", input.warmupEnabled);
  set("warmupDays", input.warmupDays);
  set("warmupStartPerDay", input.warmupStartPerDay);
  set("zernioAccountId", input.zernioAccountId);
  return row;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function newId(): string {
  return `ch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function requireEncryptionKey(env: Env): string {
  const key = env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY belum diset. Jalankan: wrangler secret put ENCRYPTION_KEY");
  }
  return key;
}

channelRoutes.get("/", async (c) => {
  const rows = await drizzle(c.env.DB).select().from(channels);
  return c.json({ channels: rows.map(toDTO) });
});

channelRoutes.get("/:id", async (c) => {
  const [row] = await drizzle(c.env.DB)
    .select()
    .from(channels)
    .where(eq(channels.id, c.req.param("id")))
    .limit(1);
  if (!row) return c.json({ error: "Channel tidak ditemukan." }, 404);
  return c.json({ channel: toDTO(row) });
});

channelRoutes.post("/", async (c) => {
  const input = await c.req.json<ChannelInput>().catch(() => null);
  if (!input?.name?.trim() || !input?.handle?.trim()) {
    return c.json({ error: "Nama dan handle channel wajib diisi." }, 400);
  }

  const id = newId();
  const row: typeof channels.$inferInsert = {
    ...toRow(input),
    id,
    name: input.name.trim(),
    handle: input.handle.trim(),
    // Prefix R2 dikunci ke id, bukan handle: handle bisa diubah operator, dan
    // objek yang sudah tersimpan tidak boleh jadi yatim karenanya.
    r2Prefix: `ternak-yt/${id}/`,
    // Warm-up dihitung dari saat channel ini dibuat, bukan tanggal global.
    warmupStartedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  if (input.zernioApiKey) {
    row.zernioApiKeyEnc = await encryptSecret(input.zernioApiKey, requireEncryptionKey(c.env));
  }

  await drizzle(c.env.DB).insert(channels).values(row);
  const [created] = await drizzle(c.env.DB).select().from(channels).where(eq(channels.id, id)).limit(1);
  return c.json({ channel: toDTO(created!) }, 201);
});

channelRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const input = await c.req.json<ChannelInput>().catch(() => null);
  if (!input) return c.json({ error: "Body tidak valid." }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!existing) return c.json({ error: "Channel tidak ditemukan." }, 404);

  const patch: Partial<typeof channels.$inferInsert> = { ...toRow(input), updatedAt: nowIso() };

  // Kunci kosong berarti "jangan diubah", bukan "hapus" — kalau tidak, setiap
  // penyimpanan form biasa akan menghapus kredensial yang tidak ditampilkan.
  if (input.zernioApiKey) {
    patch.zernioApiKeyEnc = await encryptSecret(input.zernioApiKey, requireEncryptionKey(c.env));
  }

  await db.update(channels).set(patch).where(eq(channels.id, id));
  const [updated] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  return c.json({ channel: toDTO(updated!) });
});

/**
 * Test koneksi (§7.3).
 *
 * Menerima kunci dari body (form belum disimpan) ATAU memakai kunci tersimpan.
 * Yang pertama itu intinya: operator harus bisa membuktikan kunci itu benar
 * SEBELUM menyimpannya, bukan sesudah.
 */
channelRoutes.post("/:id/test-connection", async (c) => {
  const body = await c.req.json<{ zernioApiKey?: string }>().catch(() => ({}) as { zernioApiKey?: string });
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");

  let apiKey = body.zernioApiKey?.trim();
  if (!apiKey) {
    const [row] = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
    if (!row?.zernioApiKeyEnc) {
      return c.json({ ok: false, error: "Belum ada API key Zernio untuk channel ini." }, 400);
    }
    const decrypted = await decryptSecret(row.zernioApiKeyEnc, requireEncryptionKey(c.env));
    if (!decrypted) {
      return c.json(
        { ok: false, error: "Kunci tersimpan tidak bisa didekripsi. Masukkan ulang API key." },
        400,
      );
    }
    apiKey = decrypted;
  }

  const res = await listAccounts(apiKey);
  if (!res.ok) {
    return c.json({
      ok: false,
      error:
        res.status === 401
          ? "API key ditolak Zernio (401)."
          : `Zernio menjawab HTTP ${res.status}.`,
    });
  }

  const accounts = extractAccounts(res.json);
  const youtube = accounts.filter((a) => a.platform === "youtube");

  return c.json({
    ok: true,
    total: accounts.length,
    youtube: youtube.map((a) => ({
      accountId: a._id,
      displayName: a.displayName ?? a.username ?? "(tanpa nama)",
      username: a.username ?? "",
      isActive: a.isActive ?? true,
    })),
  });
});
