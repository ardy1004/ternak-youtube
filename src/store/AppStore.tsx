import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsApi, channelsApi, opsApi, postsApi, settingsApi, videosApi } from "../lib/api";
import {
  type ActivityEntry,
  type Channel,
  type JobRun,
  type MetricPoint,
  type PostStatus,
  type ScheduledPost,
  type Video,
  type WebhookEvent,
} from "../data/mock";
import {
  slotDayOfMonth,
  slotLabel,
  slotLocalDate,
  slotLocalHour,
  todayInTimezone,
  toUtcIso,
} from "../lib/datetime";

export type DemoState = "normal" | "empty" | "loading" | "error";

/** PRD §9 — every other transition is illegal and rejected in the action. */
const LEGAL_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  scheduled: ["published", "failed", "cancelled"],
  published: [],
  failed: ["scheduled", "cancelled"],
  cancelled: [],
};

/** A post joined with the video and channel it belongs to. */
export interface Slot {
  post: ScheduledPost;
  video: Video;
  channel: Channel;
  timeLabel: string;
  localDate: string;
  dayOfMonth: number;
  hour: number;
  /** Another post on the same channel occupies this exact slot time. */
  conflict: boolean;
}

/** Global operator preferences (PRD §7.8). No credentials live here. */
export interface Settings {
  aiOutputLang: string;
  aiTone: string;
  aiPromptTemplate: string;
  notifyOnFailure: boolean;
  notifyOnPublish: boolean;
  notifyOnCronMiss: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  aiOutputLang: "Bahasa Indonesia",
  aiTone: "Conversational & Friendly",
  aiPromptTemplate:
    "Write YouTube metadata for a {{contentType}} video aimed at the {{market}} market. Match the channel's few-shot title style. Return titles, description, tags, first comment, and thumbnail text.",
  notifyOnFailure: true,
  notifyOnPublish: false,
  notifyOnCronMiss: true,
};

export interface NewVideoInput {
  channelId: string;
  title: string;
  titleVariants: string[];
  description: string;
  tags: string[];
  brief: string;
  type: string;
  market: string;
  thumbnail: string;
  /** PRD F3 — validation still failing after one regenerate lands as draft. */
  reviewQueue?: boolean;
}

interface AppState {
  channels: Channel[];
  videos: Video[];
  scheduledPosts: ScheduledPost[];
  activityFeed: ActivityEntry[];
  jobRuns: JobRun[];
  webhookEvents: WebhookEvent[];
  metricPoints: MetricPoint[];
  dryRun: boolean;
  demoState: DemoState;
  settings: Settings;
  today: string;

  slots: Slot[];
  todaySlots: Slot[];
  channelById: (id: string) => Channel | undefined;
  videoById: (id: string) => Video | undefined;

  /**
   * Dipanggil SETELAH UploadFlow membuat video di server. Tugasnya hanya
   * menyegarkan cache dan mencatat ke jurnal, bukan membuat entitas.
   */
  addVideo: (input: NewVideoInput) => Promise<void>;
  updateVideoMetadata: (videoId: string, patch: Partial<Video>) => Promise<void>;
  /** Menulis ke server, jadi async. Pemanggil boleh mengabaikan Promise-nya. */
  toggleChannelStatus: (channelId: string) => Promise<void>;
  // Semua aksi di bawah menulis ke server. Diketik Promise supaya pemanggil
  // yang perlu menunggu atau menangkap penolakan bisa melakukannya; handler
  // onClick tetap boleh mengabaikannya.
  cancelPost: (postId: string) => Promise<void>;
  retryPost: (postId: string) => Promise<void>;
  reschedulePost: (postId: string, localDate: string, localTime?: string) => Promise<void>;
  addChannel: (channel: Omit<Channel, "id">) => Promise<Channel>;
  updateChannel: (channelId: string, patch: Partial<Channel>) => Promise<void>;
  /** Status pemuatan channel dari server — dipakai layar untuk skeleton/error. */
  channelsLoading: boolean;
  channelsError: boolean;
  setDryRun: (value: boolean) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  resetDemoData: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  /**
   * Semua data inti dibaca dari D1 lewat API.
   *
   * Yang tersisa di klien hanya `activityFeed` — jurnal aksi operator selama
   * satu sesi. Padanan servernya adalah `job_runs`, yang dibaca terpisah di
   * bawah dan bertahan lintas sesi.
   */
  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await channelsApi.list()).channels as unknown as Channel[],
  });
  const videosQuery = useQuery({
    queryKey: ["videos"],
    queryFn: async () => (await videosApi.list()).videos as unknown as Video[],
  });
  const postsQuery = useQuery({
    queryKey: ["posts"],
    queryFn: async () => (await postsApi.list()).posts,
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await settingsApi.get()).settings,
  });
  const analyticsQuery = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => analyticsApi.points(30),
  });
  const weeklyViewsQuery = useQuery({
    queryKey: ["weekly-views"],
    queryFn: async () => (await analyticsApi.weeklyViews()).weeklyViews,
  });
  const jobRunsQuery = useQuery({
    queryKey: ["job-runs"],
    queryFn: async () => (await opsApi.jobRuns()).jobRuns,
  });
  /**
   * Akan kosong sampai keberadaan webhook Zernio dikonfirmasi (§12) — dan
   * kosong adalah jawaban yang benar. Menampilkan peristiwa webhook contoh di
   * layar audit akan membuat operator mengira ada mekanisme yang sedang
   * berjalan padahal belum.
   */
  const webhookEventsQuery = useQuery({
    queryKey: ["webhook-events"],
    queryFn: async () => (await opsApi.webhookEvents()).webhookEvents,
  });

  const videos = videosQuery.data ?? [];

  // weeklyViews datang dari metric_snapshots, bukan dari baris channel —
  // menyimpannya di channels akan membuat angka basi setiap kali metrik
  // disinkronkan.
  const channels = useMemo<Channel[]>(() => {
    const views = weeklyViewsQuery.data ?? {};
    return (channelsQuery.data ?? []).map((c) => ({ ...c, weeklyViews: views[c.id] ?? 0 }));
  }, [channelsQuery.data, weeklyViewsQuery.data]);

  const metricPoints = useMemo<MetricPoint[]>(
    () =>
      (analyticsQuery.data?.points ?? []).map((p) => ({
        date: p.date,
        channelId: p.channelId,
        contentType: p.contentType,
        market: p.market,
        views: p.views,
        watchTimeSec: p.watchTimeSec,
        // Satu snapshot = satu post yang terbit pada hari itu.
        videosPublished: 1,
      })),
    [analyticsQuery.data],
  );

  const webhookEvents = useMemo<WebhookEvent[]>(
    () =>
      (webhookEventsQuery.data ?? []).map((w) => ({
        id: w.id,
        source: w.source,
        type: w.eventType ?? "unknown",
        channel: "",
        timestamp: w.receivedAt,
        status: "info" as const,
      })),
    [webhookEventsQuery.data],
  );

  const jobRuns = useMemo<JobRun[]>(
    () =>
      (jobRunsQuery.data ?? []).map((j) => ({
        id: j.id,
        type: j.jobType,
        status: j.status === "success" ? "success" : "failed",
        started: j.startedAt,
        finished: j.finishedAt ?? "",
        detail: j.detailJson ?? "",
      })),
    [jobRunsQuery.data],
  );

  /**
   * Post server dipetakan ke bentuk `ScheduledPost` yang dipakai layar.
   *
   * `idempotencyKey` sengaja diturunkan di sini alih-alih dikirim server: ia
   * milik server, dan mengekspornya ke klien hanya mengundang klien
   * memalsukannya.
   */
  const scheduledPosts = useMemo<ScheduledPost[]>(
    () =>
      (postsQuery.data ?? []).map((p) => ({
        id: p.id,
        videoId: p.videoId,
        channelId: p.channelId,
        slotTimeUtc: p.slotTimeUtc,
        status: p.status as PostStatus,
        idempotencyKey: `${p.channelId}:${p.videoId}:${p.slotTimeUtc}`,
        retryCount: p.retryCount,
        failReason: p.failReason,
        zernioPostId: p.zernioPostId,
      })) as ScheduledPost[],
    [postsQuery.data],
  );

  const invalidate = useCallback(
    (key: string) => queryClient.invalidateQueries({ queryKey: [key] }),
    [queryClient],
  );
  const invalidateChannels = useCallback(() => invalidate("channels"), [invalidate]);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  /**
   * `demoState` dulu disetel manual lewat DemoStateSwitcher supaya state §7
   * bisa didemokan di prototipe. Sekarang datanya nyata, jadi ia DITURUNKAN
   * dari keadaan sebenarnya — saklar manualnya dibuang.
   *
   * Ini membuat keenam layar yang sudah membacanya langsung menampilkan
   * skeleton saat benar-benar memuat dan banner error saat server benar-benar
   * bermasalah, tanpa satu pun layar diubah.
   *
   * Error menang atas loading: kalau salah satu query gagal, memperlihatkan
   * skeleton selamanya lebih buruk daripada mengatakan ada yang salah.
   */
  const demoState: DemoState = useMemo(() => {
    const queries = [channelsQuery, videosQuery, postsQuery, settingsQuery];
    if (queries.some((q) => q.isError)) return "error";
    if (queries.some((q) => q.isPending)) return "loading";
    return "normal";
  }, [
    channelsQuery.isError, channelsQuery.isPending,
    videosQuery.isError, videosQuery.isPending,
    postsQuery.isError, postsQuery.isPending,
    settingsQuery.isError, settingsQuery.isPending,
  ]);

  // Dry-run adalah setelan SERVER (PRD §4, ditegakkan saat dispatch). UI hanya
  // mencerminkannya — kalau ia hidup di state klien, indikatornya bisa
  // berbohong tentang apa yang sebenarnya akan dilakukan server.
  const dryRun = settingsQuery.data?.dryRun ?? true;
  const settings = useMemo<Settings>(
    () => ({
      aiOutputLang: settingsQuery.data?.aiOutputLang ?? DEFAULT_SETTINGS.aiOutputLang,
      aiTone: settingsQuery.data?.aiTone ?? DEFAULT_SETTINGS.aiTone,
      aiPromptTemplate: settingsQuery.data?.aiPromptTemplate ?? DEFAULT_SETTINGS.aiPromptTemplate,
      notifyOnFailure: settingsQuery.data?.notifyOnFailure ?? DEFAULT_SETTINGS.notifyOnFailure,
      notifyOnPublish: settingsQuery.data?.notifyOnPublish ?? DEFAULT_SETTINGS.notifyOnPublish,
      notifyOnCronMiss: settingsQuery.data?.notifyOnCronMiss ?? DEFAULT_SETTINGS.notifyOnCronMiss,
    }),
    [settingsQuery.data],
  );

  /**
   * Jurnal aksi operator selama satu sesi, dengan waktu SUNGGUHAN.
   *
   * Prototipe memakai jam beku (`CLOCK_BASE`) yang memajukan setiap entri satu
   * menit dari 2024-12-20, supaya urutannya rapi di tangkapan layar. Dengan data
   * nyata itu berbahaya: log yang menunjukkan waktu palsu adalah log yang
   * menyesatkan justru ketika sedang dipakai menelusuri masalah.
   */
  const log = useCallback((entry: Omit<ActivityEntry, "id" | "timestamp">) => {
    setActivity((prev) => [
      {
        ...entry,
        id: `act_${Date.now()}_${prev.length}`,
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
      ...prev,
    ]);
  }, []);

  const channelById = useCallback(
    (id: string) => channels.find((c) => c.id === id),
    [channels]
  );
  const videoById = useCallback((id: string) => videos.find((v) => v.id === id), [videos]);

  const slots = useMemo<Slot[]>(() => {
    const joined = scheduledPosts
      .map((post) => {
        const video = videos.find((v) => v.id === post.videoId);
        const channel = channels.find((c) => c.id === post.channelId);
        if (!video || !channel) return null;
        const slot: Slot = {
          post,
          video,
          channel,
          timeLabel: slotLabel(post.slotTimeUtc, channel.timezone),
          localDate: slotLocalDate(post.slotTimeUtc, channel.timezone),
          dayOfMonth: slotDayOfMonth(post.slotTimeUtc, channel.timezone),
          hour: slotLocalHour(post.slotTimeUtc, channel.timezone),
          conflict: false,
        };
        return slot;
      })
      .filter((s): s is Slot => s !== null)
      .sort((a, b) => a.post.slotTimeUtc.localeCompare(b.post.slotTimeUtc));

    // PRD §7.6 — two live posts on one channel at the same instant is a conflict.
    const seen = new Map<string, number>();
    for (const slot of joined) {
      if (slot.post.status === "cancelled") continue;
      const key = `${slot.channel.id}@${slot.post.slotTimeUtc}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const slot of joined) {
      if (slot.post.status === "cancelled") continue;
      slot.conflict = (seen.get(`${slot.channel.id}@${slot.post.slotTimeUtc}`) ?? 0) > 1;
    }
    return joined;
  }, [scheduledPosts, videos, channels]);

  /**
   * "Hari ini" dihitung PER SLOT, di zona channel-nya masing-masing.
   *
   * Membandingkan semua slot terhadap satu tanggal global akan salah begitu ada
   * dua channel di zona berbeda: pukul 23:00 di Jakarta sudah hari berikutnya,
   * sementara di New York belum. Slot itu "hari ini" bagi channel-nya sendiri,
   * bukan bagi jam dinding operator.
   */
  const todaySlots = useMemo(
    () => slots.filter((s) => s.localDate === todayInTimezone(s.channel.timezone)),
    [slots],
  );

  /** Tanggal yang ditampilkan di top bar — zona channel pertama, atau WIB. */
  const today = useMemo(
    () => todayInTimezone(channels[0]?.timezone ?? "Asia/Jakarta"),
    [channels],
  );

  /**
   * Video SUDAH dibuat di server sebelum ini dipanggil.
   *
   * UploadFlow yang mengunggah byte-nya (multipart ke R2), memanggil Gemini,
   * lalu mengonfirmasi metadata. Yang tersisa di sini hanya menyegarkan cache
   * dan mencatat ke jurnal aksi — TIDAK membuat baris baru. Membuat entitas di
   * dua tempat adalah cara termudah membuat keduanya tidak sinkron.
   */
  const addVideo = useCallback<AppState["addVideo"]>(
    async (input) => {
      await Promise.all([invalidate("videos"), invalidate("posts")]);
      const channel = channels.find((c) => c.id === input.channelId);
      log({
        type: "upload",
        status: input.reviewQueue ? "info" : "success",
        channel: channel?.name ?? "Unknown channel",
        videoTitle: input.title,
        message: input.reviewQueue
          ? "Sent to review queue — metadata validation failed after regenerate"
          : "Video added to pool — awaiting slot assignment",
      });
    },
    [channels, log, invalidate]
  );

  const updateVideoMetadata = useCallback<AppState["updateVideoMetadata"]>(
    async () => {
      // Metadata disunting lewat alur konfirmasi F3 di server, yang
      // memvalidasinya ulang. Di sini cukup menyegarkan.
      await invalidate("videos");
    },
    [invalidate]
  );

  const toggleChannelStatus = useCallback<AppState["toggleChannelStatus"]>(
    async (channelId) => {
      const channel = channels.find((c) => c.id === channelId);
      if (!channel) return;
      const nextStatus: Channel["status"] = channel.status === "active" ? "paused" : "active";

      await channelsApi.update(channelId, { status: nextStatus });
      await invalidateChannels();
      log({
        type: "channel",
        status: "info",
        channel: channel.name,
        message:
          nextStatus === "paused"
            ? "Channel paused — all scheduler pushes halted"
            : "Channel resumed — scheduler pushes re-enabled",
      });
    },
    [channels, log, invalidateChannels]
  );

  /**
   * Transisi status dijalankan SERVER, tidak lagi di sini.
   *
   * `LEGAL_TRANSITIONS` di atas tetap dipertahankan sebagai penjaga cepat di
   * UI (menonaktifkan tombol yang pasti ditolak), tapi ia bukan lagi
   * penegaknya — server menolak transisi ilegal dengan 409 walau UI-nya
   * dilewati sama sekali.
   */
  const cancelPost = useCallback<AppState["cancelPost"]>(
    async (postId) => {
      const slot = slots.find((s) => s.post.id === postId);
      if (!slot) return;
      await postsApi.cancel(postId);
      await Promise.all([invalidate("posts"), invalidate("videos")]);
      log({
        type: "cancel",
        status: "info",
        channel: slot.channel.name,
        videoTitle: slot.video.title,
        message: "Post cancelled by operator",
      });
    },
    [slots, log, invalidate]
  );

  const retryPost = useCallback<AppState["retryPost"]>(
    async (postId) => {
      const slot = slots.find((s) => s.post.id === postId);
      if (!slot) return;
      const attempt = slot.post.retryCount + 1;
      await postsApi.retry(postId);
      await Promise.all([invalidate("posts"), invalidate("videos")]);
      log({
        type: "retry",
        status: "info",
        channel: slot.channel.name,
        videoTitle: slot.video.title,
        message: dryRun
          ? `Retry queued (dry-run) — attempt ${attempt}/3, no push to Zernio`
          : `Retry queued — attempt ${attempt}/3`,
      });
    },
    [slots, log, dryRun, invalidate]
  );

  const reschedulePost = useCallback<AppState["reschedulePost"]>(
    async (postId, localDate, localTime) => {
      const slot = slots.find((s) => s.post.id === postId);
      if (!slot || slot.post.status === "cancelled" || slot.post.status === "published") return;

      const time = localTime ?? slot.timeLabel.slice(0, 5);
      const slotTimeUtc = toUtcIso(localDate, time, slot.channel.timezone);
      if (slotTimeUtc === slot.post.slotTimeUtc) return;

      // Server bisa menolak (mis. post sudah diserahkan ke Zernio — jadwalnya
      // kini milik mereka). Biarkan errornya naik daripada memindahkan kartu di
      // layar dan membiarkan D1 berbohong soal kapan video itu tayang.
      await postsApi.reschedule(postId, slotTimeUtc);
      await invalidate("posts");
      log({
        type: "cron",
        status: "info",
        channel: slot.channel.name,
        videoTitle: slot.video.title,
        message: `Rescheduled to ${localDate} ${time} ${slot.timeLabel.slice(6)}`,
      });
    },
    [slots, log, invalidate]
  );

  const addChannel = useCallback<AppState["addChannel"]>(
    async (input) => {
      const { channel } = await channelsApi.create(input as never);
      await invalidateChannels();
      log({
        type: "channel",
        status: "success",
        channel: channel.name,
        message: `Channel created — ${channel.videosPerDay} video/day in ${channel.timezone}`,
      });
      return channel as unknown as Channel;
    },
    [log, invalidateChannels]
  );

  const updateChannel = useCallback<AppState["updateChannel"]>(
    async (channelId, patch) => {
      const existing = channels.find((c) => c.id === channelId);
      if (!existing) return;
      await channelsApi.update(channelId, patch as never);
      await invalidateChannels();
      log({
        type: "channel",
        status: "info",
        channel: patch.name ?? existing.name,
        message: "Channel configuration updated",
      });
    },
    [channels, log, invalidateChannels]
  );

  const updateSettings = useCallback<AppState["updateSettings"]>(
    async (patch) => {
      await settingsApi.update(patch);
      await invalidate("settings");
    },
    [invalidate]
  );

  /** Dry-run adalah setelan server; saklar di sidebar hanya memanggilnya. */
  const setDryRun = useCallback(
    async (value: boolean) => {
      await settingsApi.update({ dryRun: value });
      await invalidate("settings");
    },
    [invalidate]
  );

  /**
   * Memuat ulang semuanya dari server.
   *
   * Bukan lagi "reset ke seed": data sekarang milik D1, dan tombol yang
   * menghapus channel atau video sungguhan operator bukan alat demo — itu
   * kehilangan data. Jurnal aksi sisi-klien saja yang benar-benar dikosongkan.
   */
  const resetDemoData = useCallback(() => {
    setActivity([]);
    void Promise.all([
      invalidate("channels"),
      invalidate("videos"),
      invalidate("posts"),
      invalidate("settings"),
      invalidate("analytics"),
      invalidate("weekly-views"),
      invalidate("job-runs"),
      invalidate("webhook-events"),
    ]);
  }, [invalidate]);

  const value = useMemo<AppState>(
    () => ({
      channels: channels,
      videos: videos,
      scheduledPosts: scheduledPosts,
      activityFeed: activity,
      jobRuns: jobRuns,
      webhookEvents,
      metricPoints: metricPoints,
      dryRun,
      demoState,
      settings,
      today,
      slots: slots,
      todaySlots: todaySlots,
      channelById,
      videoById,
      addVideo,
      updateVideoMetadata,
      toggleChannelStatus,
      cancelPost,
      retryPost,
      reschedulePost,
      addChannel,
      updateChannel,
      channelsLoading: channelsQuery.isPending,
      channelsError: channelsQuery.isError,
      setDryRun,
      updateSettings,
      resetDemoData,
    }),
    [
      channels, videos, scheduledPosts, activity, dryRun, demoState, settings, slots, todaySlots, today,
      channelById, videoById, addVideo, updateVideoMetadata, toggleChannelStatus,
      cancelPost, retryPost, reschedulePost, addChannel, updateChannel, updateSettings,
      resetDemoData, channelsQuery.isPending, channelsQuery.isError,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
