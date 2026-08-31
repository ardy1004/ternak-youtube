/**
 * Post terjadwal — pembacaan untuk Dashboard/Schedule, plus aksi operator.
 *
 * State machine PRD §9 ditegakkan di SINI, di server. Di prototipe ia hidup di
 * store browser, yang berarti bisa dilewati siapa pun yang memanggil endpoint
 * langsung.
 */
import { Hono, type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { channels, scheduledPosts, settings, videoAssets, videoMetadata } from "../db/schema";
import { buildScheduleForChannel, isDryRun, recordJobRun } from "../lib/scheduler";
import type { SessionData } from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const postRoutes = new Hono<Vars>();

/** Transisi legal (PRD §9). Selain ini ditolak. */
const LEGAL: Record<string, string[]> = {
  queued: ["dispatching", "cancelled"],
  dispatching: ["scheduled", "failed"],
  scheduled: ["published", "failed", "cancelled"],
  published: [],
  failed: ["queued", "cancelled"],
  cancelled: [],
};

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

postRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      post: scheduledPosts,
      video: videoAssets,
      channel: channels,
      meta: videoMetadata,
    })
    .from(scheduledPosts)
    .innerJoin(videoAssets, eq(videoAssets.id, scheduledPosts.videoId))
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .leftJoin(videoMetadata, eq(videoMetadata.videoId, scheduledPosts.videoId))
    .orderBy(scheduledPosts.slotTimeUtc);

  return c.json({
    posts: rows.map((r) => ({
      id: r.post.id,
      videoId: r.post.videoId,
      channelId: r.post.channelId,
      slotTimeUtc: r.post.slotTimeUtc,
      status: r.post.status,
      failReason: r.post.failReason,
      retryCount: r.post.retryCount,
      zernioPostId: r.post.zernioPostId,
      dryRun: r.post.dryRun,
      publishedAt: r.post.publishedAt,
      videoTitle: r.meta?.titleSelected ?? "(tanpa judul)",
      channelName: r.channel.name,
      channelTimezone: r.channel.timezone,
    })),
  });
});

async function transition(
  c: Context<Vars>,
  postId: string,
  to: string,
  patch: Record<string, unknown> = {},
) {
  const db = drizzle(c.env.DB);
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1);
  if (!post) return c.json({ error: "Post tidak ditemukan." }, 404);

  if (!(LEGAL[post.status] ?? []).includes(to)) {
    return c.json(
      { error: `Transisi ilegal: ${post.status} → ${to}. Ditolak sesuai PRD §9.` },
      409,
    );
  }

  await db
    .update(scheduledPosts)
    .set({ status: to, updatedAt: nowIso(), ...patch })
    .where(eq(scheduledPosts.id, postId));
  return c.json({ ok: true, from: post.status, to });
}

postRoutes.post("/:id/cancel", async (c) => transition(c, c.req.param("id"), "cancelled"));

postRoutes.post("/:id/retry", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id)).limit(1);
  if (!post) return c.json({ error: "Post tidak ditemukan." }, 404);

  const res = await transition(c, id, "queued", {
    retryCount: post.retryCount + 1,
    failReason: null,
  });
  // Antre ulang HANYA kalau transisinya diterima — kalau tidak, post yang sudah
  // terbit bisa dikirim dua kali.
  if (res.status === 200) {
    await c.env.DISPATCH.send({ postId: id });
  }
  return res;
});

postRoutes.post("/:id/reschedule", async (c) => {
  const body = await c.req.json<{ slotTimeUtc?: string }>().catch(() => null);
  if (!body?.slotTimeUtc) return c.json({ error: "slotTimeUtc wajib diisi." }, 400);
  if (Number.isNaN(Date.parse(body.slotTimeUtc))) {
    return c.json({ error: "slotTimeUtc bukan tanggal yang sah." }, 400);
  }

  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id)).limit(1);
  if (!post) return c.json({ error: "Post tidak ditemukan." }, 404);

  // Post yang sudah diserahkan ke Zernio tidak bisa dipindah dari sini —
  // jadwalnya sekarang milik Zernio, dan mengubah baris kita saja hanya membuat
  // D1 berbohong tentang kapan video itu tayang.
  if (post.status === "scheduled" && post.zernioPostId) {
    return c.json(
      { error: "Post sudah diserahkan ke Zernio. Batalkan dulu, lalu jadwalkan ulang." },
      409,
    );
  }
  if (["published", "cancelled"].includes(post.status)) {
    return c.json({ error: `Post berstatus ${post.status} tidak bisa dijadwal ulang.` }, 409);
  }

  const slotTimeUtc = new Date(body.slotTimeUtc).toISOString().replace(/\.\d{3}Z$/, "Z");
  await db
    .update(scheduledPosts)
    .set({
      slotTimeUtc,
      idempotencyKey: `${post.channelId}|${post.videoId}|${slotTimeUtc}`,
      updatedAt: nowIso(),
    })
    .where(eq(scheduledPosts.id, id));

  return c.json({ ok: true, slotTimeUtc });
});

/** Memicu build harian secara manual — dipakai untuk menguji tanpa menunggu cron. */
postRoutes.post("/build-now", async (c) => {
  const startedAt = nowIso();
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(channels).where(eq(channels.status, "active"));

  const results = [];
  for (const channel of rows) {
    try {
      results.push({ channel: channel.name, ...(await buildScheduleForChannel(c.env, channel)) });
    } catch (err) {
      results.push({ channel: channel.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await recordJobRun(c.env, "build-schedule-manual", "success", results, startedAt);
  return c.json({ dryRun: await isDryRun(db), results });
});

/**
 * Setelan global dan riwayat job dipisah ke router sendiri, bukan digantung di
 * bawah /posts — keduanya bukan milik entitas post, dan menaruhnya di sana akan
 * bertabrakan dengan pola `/:id`.
 */
export const settingsRoutes = new Hono<Vars>();
export const opsRoutes = new Hono<Vars>();

settingsRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  return c.json({
    settings: row ?? {
      id: "default",
      dryRun: true,
      aiOutputLang: "Bahasa Indonesia",
      aiTone: "Conversational & Friendly",
      aiPromptTemplate: null,
      notifyOnFailure: true,
      notifyOnPublish: false,
      notifyOnCronMiss: true,
    },
  });
});

settingsRoutes.patch("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "Body tidak valid." }, 400);

  const db = drizzle(c.env.DB);
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const key of [
    "dryRun",
    "aiOutputLang",
    "aiTone",
    "aiPromptTemplate",
    "notifyOnFailure",
    "notifyOnPublish",
    "notifyOnCronMiss",
  ]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  const updated = await db
    .update(settings)
    .set(patch)
    .where(eq(settings.id, "default"))
    .returning();

  if (updated.length === 0) {
    await db.insert(settings).values({ id: "default", ...patch } as never);
  }

  const [row] = await db.select().from(settings).where(eq(settings.id, "default")).limit(1);
  return c.json({ settings: row });
});

/** Riwayat job untuk Activity & Logs (§7.7). */
opsRoutes.get("/job-runs", async (c) => {
  const { jobRuns } = await import("../db/schema");
  const rows = await drizzle(c.env.DB)
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(50);
  return c.json({ jobRuns: rows });
});
