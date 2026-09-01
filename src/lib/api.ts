/**
 * Klien HTTP untuk API Worker.
 *
 * Semua permintaan mengirim cookie sesi. Cookie-nya HttpOnly, jadi JavaScript
 * tidak bisa membacanya — itu memang tujuannya: XSS tidak bisa mencuri sesi.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 401 diperlakukan khusus: aplikasi harus kembali ke layar login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // `same-origin` sudah cukup (SPA dan API satu origin) dan lebih ketat
      // daripada `include`.
      credentials: "same-origin",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // Gagal di lapisan jaringan, bukan HTTP — dibedakan supaya UI bisa bilang
    // "tidak bisa menghubungi server", bukan "server menolak".
    throw new ApiError(0, "Tidak bisa menghubungi server.");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Respons non-JSON pada route /api hampir pasti berarti salah alamat dan
      // yang kembali adalah index.html. Katakan apa adanya.
      throw new ApiError(res.status, `Respons bukan JSON (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Permintaan gagal (HTTP ${res.status}).`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Bentuk channel dari server. Sengaja dibuat identik dengan `Channel` di
 * src/data/mock.ts supaya layar yang sudah jadi tidak perlu diubah —
 * pemetaan dari baris database dikurung di worker/routes/channels.ts.
 */
export interface ChannelDTO {
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
  hasZernioKey: boolean;
  zernioAccountId: string;
  baseTimes: string[];
  driftMinutesPerDay: number;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  total?: number;
  youtube?: Array<{
    accountId: string;
    displayName: string;
    username: string;
    isActive: boolean;
  }>;
}

export const channelsApi = {
  list: () => api.get<{ channels: ChannelDTO[] }>("/channels"),
  create: (input: Partial<ChannelDTO> & { zernioApiKey?: string }) =>
    api.post<{ channel: ChannelDTO }>("/channels", input),
  update: (id: string, patch: Partial<ChannelDTO> & { zernioApiKey?: string }) =>
    api.patch<{ channel: ChannelDTO }>(`/channels/${id}`, patch),
  testConnection: (id: string, zernioApiKey?: string) =>
    api.post<TestConnectionResult>(`/channels/${id}/test-connection`, { zernioApiKey }),
};

export interface VideoDTO {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string;
  type: string;
  market: string;
  status: string;
  brief: string;
  tags: string[];
  description: string;
  titleVariants: string[];
  createdAt: string;
  durationSec: number;
}

export interface PostDTO {
  id: string;
  videoId: string;
  channelId: string;
  slotTimeUtc: string;
  status: string;
  failReason: string | null;
  retryCount: number;
  zernioPostId: string | null;
  dryRun: boolean;
  publishedAt: string | null;
  videoTitle: string;
  channelName: string;
  channelTimezone: string;
}

export interface SettingsDTO {
  dryRun: boolean;
  aiOutputLang: string;
  aiTone: string;
  aiPromptTemplate: string | null;
  notifyOnFailure: boolean;
  notifyOnPublish: boolean;
  notifyOnCronMiss: boolean;
}

export interface JobRunDTO {
  id: string;
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  detailJson: string | null;
}

export const videosApi = {
  list: () => api.get<{ videos: VideoDTO[] }>("/videos"),
  remove: (id: string) => api.del<{ ok: true }>(`/videos/${id}`),
  generate: (id: string) =>
    api.post<{
      metadata: { titles: string[]; description: string; tags: string[] };
      validation: { pass: boolean; checks: Array<{ id: string; label: string; pass: boolean; detail: string }> };
      validationStatus: string;
      attemptsLeft: number;
      sentToReview: boolean;
    }>(`/metadata/${id}/generate`),
  confirm: (id: string, patch?: { titleSelected?: string; description?: string; tags?: string[] }) =>
    api.post<{ ok: true; status: string }>(`/metadata/${id}/confirm`, patch ?? {}),
};

export const postsApi = {
  list: () => api.get<{ posts: PostDTO[] }>("/posts"),
  cancel: (id: string) => api.post<{ ok: true }>(`/posts/${id}/cancel`),
  retry: (id: string) => api.post<{ ok: true }>(`/posts/${id}/retry`),
  reschedule: (id: string, slotTimeUtc: string) =>
    api.post<{ ok: true }>(`/posts/${id}/reschedule`, { slotTimeUtc }),
  buildNow: () => api.post<{ dryRun: boolean; results: unknown[] }>("/posts/build-now"),
};

export const settingsApi = {
  get: () => api.get<{ settings: SettingsDTO }>("/settings"),
  update: (patch: Partial<SettingsDTO>) => api.patch<{ settings: SettingsDTO }>("/settings", patch),
};

export interface WebhookEventDTO {
  id: string;
  source: string;
  eventType: string | null;
  payloadJson: string | null;
  receivedAt: string;
}

export const opsApi = {
  jobRuns: () => api.get<{ jobRuns: JobRunDTO[] }>("/ops/job-runs"),
  webhookEvents: () =>
    api.get<{ webhookEvents: WebhookEventDTO[] }>("/analytics/webhook-events"),
};

export interface MetricPointDTO {
  date: string;
  channelId: string;
  channelName: string;
  contentType: string;
  market: string;
  views: number;
  watchTimeSec: number;
  likes: number;
  comments: number;
  subsGained: number;
}

export const analyticsApi = {
  points: (days = 30) =>
    api.get<{ points: MetricPointDTO[]; hasData: boolean; days: number }>(
      `/analytics?days=${days}`,
    ),
  weeklyViews: () => api.get<{ weeklyViews: Record<string, number> }>("/analytics/weekly-views"),
};

export const authApi = {
  me: () => api.get<{ user: AuthUser }>("/auth/me"),
  login: (username: string, password: string) =>
    api.post<{ ok: true; user: AuthUser }>("/auth/login", { username, password }),
  logout: () => api.post<{ ok: true }>("/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>("/auth/change-password", { currentPassword, newPassword }),
};
