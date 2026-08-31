/**
 * Analitik — dibaca dari metric_snapshots, bukan dikarang.
 *
 * Selama belum ada post yang benar-benar terbit, endpoint ini mengembalikan
 * deret kosong. Itu jawaban yang jujur: angka contoh yang terlihat nyata di
 * dashboard operasional lebih berbahaya daripada grafik kosong, karena
 * keputusan produksi konten diambil dari sini.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, gte, sql } from "drizzle-orm";
import { channels, metricSnapshots, scheduledPosts, videoAssets } from "../db/schema";
import type { SessionData } from "../lib/session";
import type { Env } from "../index";

type Vars = { Variables: { session: SessionData }; Bindings: Env };

export const analyticsRoutes = new Hono<Vars>();

analyticsRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      capturedOn: metricSnapshots.capturedOn,
      views: metricSnapshots.views,
      watchTimeSec: metricSnapshots.watchTimeSec,
      likes: metricSnapshots.likes,
      comments: metricSnapshots.comments,
      subsGained: metricSnapshots.subsGained,
      channelId: scheduledPosts.channelId,
      channelName: channels.name,
      contentType: videoAssets.contentType,
      market: videoAssets.market,
    })
    .from(metricSnapshots)
    .innerJoin(scheduledPosts, eq(scheduledPosts.id, metricSnapshots.scheduledPostId))
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .innerJoin(videoAssets, eq(videoAssets.id, scheduledPosts.videoId))
    .where(gte(metricSnapshots.capturedOn, since))
    .orderBy(metricSnapshots.capturedOn);

  return c.json({
    points: rows.map((r) => ({
      date: r.capturedOn,
      channelId: r.channelId,
      channelName: r.channelName,
      contentType: r.contentType ?? "",
      market: r.market ?? "",
      views: r.views ?? 0,
      watchTimeSec: r.watchTimeSec ?? 0,
      likes: r.likes ?? 0,
      comments: r.comments ?? 0,
      subsGained: r.subsGained ?? 0,
    })),
    // Dibedakan dari "semua nol": belum ada data sama sekali adalah keadaan
    // yang berbeda dari performa yang memang nol, dan layar perlu tahu bedanya.
    hasData: rows.length > 0,
    days,
  });
});

/**
 * Total views 7 hari terakhir per channel — dipakai kartu di layar Channels.
 *
 * Diagregasi per POST dulu, baru dijumlahkan per channel. Ini bukan detail
 * gaya: `views` bersifat KUMULATIF per post, jadi menjumlahkan seluruh snapshot
 * harian akan menghitung penonton yang sama berulang kali. Yang benar adalah
 * nilai tertinggi (= terakhir) tiap post.
 *
 * Digabungkan di JS alih-alih satu query pintar dengan subquery beralias:
 * volumenya kecil (puluhan post), dan versi SQL-nya gagal diam-diam dengan
 * "no such column" saat alias tidak terbawa.
 */
analyticsRoutes.get("/weekly-views", async (c) => {
  const db = drizzle(c.env.DB);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const perPost = await db
    .select({
      postId: metricSnapshots.scheduledPostId,
      views: sql<number>`MAX(COALESCE(${metricSnapshots.views}, 0))`,
    })
    .from(metricSnapshots)
    .where(gte(metricSnapshots.capturedOn, since))
    .groupBy(metricSnapshots.scheduledPostId);

  if (perPost.length === 0) return c.json({ weeklyViews: {} });

  const owners = await db
    .select({ id: scheduledPosts.id, channelId: scheduledPosts.channelId })
    .from(scheduledPosts);
  const channelOf = new Map(owners.map((o) => [o.id, o.channelId]));

  const weeklyViews: Record<string, number> = {};
  for (const row of perPost) {
    const channelId = channelOf.get(row.postId);
    if (!channelId) continue;
    weeklyViews[channelId] = (weeklyViews[channelId] ?? 0) + (Number(row.views) || 0);
  }
  return c.json({ weeklyViews });
});

/** Peristiwa webhook mentah — audit (§11). */
analyticsRoutes.get("/webhook-events", async (c) => {
  const { webhookEvents } = await import("../db/schema");
  const rows = await drizzle(c.env.DB)
    .select()
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(50);
  return c.json({ webhookEvents: rows });
});
