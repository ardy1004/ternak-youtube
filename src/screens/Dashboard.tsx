import { useState } from "react";
import { useApp, type Slot } from "../store/AppStore";
import { utcTime } from "../lib/datetime";
import { EmptyState, ErrorBanner, PanelSkeleton, RowSkeleton, ScreenShell } from "../components/states";

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} />;
}

function FailedDrawer({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const { retryPost, cancelPost, dryRun } = useApp();
  const { post, video, channel } = slot;

  const history = [
    post.retryCount > 0 && {
      time: "10:05 UTC",
      label: `Retry queued (attempt ${post.retryCount}/3 in 30 min)`,
      failed: false,
    },
    { time: "10:01 UTC", label: "Webhook received: zernio.post.failed", failed: true },
    { time: "10:00 UTC", label: "Push to Zernio — scheduled publish triggered", failed: false },
    { time: video.createdAt.slice(0, 10), label: "Video queued for scheduling", failed: false },
  ].filter(Boolean) as { time: string; label: string; failed: boolean }[];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[480px] flex flex-col border-l border-border bg-surface-1 overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <StatusDot status="failed" />
            <span className="text-sm font-medium text-text-primary">Failed Post — Detail</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close detail"
            className="w-6 h-6 flex items-center justify-center rounded text-xs hover:bg-overlay transition-fast text-text-muted"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <div className="label-caps mb-2">Video</div>
            <div className="text-sm font-medium text-text-primary">{video.title}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label-caps mb-1">Channel</div>
              <div className="text-sm text-text-secondary">{channel.name}</div>
            </div>
            <div>
              <div className="label-caps mb-1">Scheduled</div>
              <div className="font-mono text-sm text-text-secondary">
                {slot.localDate} {slot.timeLabel}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-md border border-danger/20 bg-danger/8">
            <div className="label-caps mb-1 text-danger-text">Error</div>
            <div className="text-sm text-danger-subtle">
              {post.failReason ?? "Unknown error reported by Zernio."}
            </div>
          </div>

          <div>
            <div className="label-caps mb-2">Error Classification</div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded font-mono bg-danger/12 text-danger-text">
                quota_exceeded
              </span>
              <span className="text-xs text-text-muted">
                Channel-level issue — manual action required
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label-caps mb-1">Retry Count</div>
              <div className="font-mono text-sm text-text-secondary">{post.retryCount}/3</div>
            </div>
            <div>
              <div className="label-caps mb-1">Idempotency Key</div>
              <div className="font-mono text-xs truncate text-text-muted">
                {post.idempotencyKey}
              </div>
            </div>
          </div>

          <div>
            <div className="label-caps mb-2">Status History</div>
            <div className="space-y-2">
              {history.map((ev, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="font-mono text-xs pt-0.5 w-20 flex-shrink-0 text-text-muted">
                    {ev.time}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot status={ev.failed ? "failed" : "scheduled"} />
                    <div className="text-xs text-text-secondary">{ev.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {dryRun && (
            <div className="p-3 rounded-md border border-accent/25 bg-accent/6 text-xs text-accent">
              Dry-run is ON — retrying re-queues the slot locally but will not push to Zernio.
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <button
              onClick={() => {
                retryPost(post.id);
                onClose();
              }}
              className="flex-1 py-2 text-sm font-medium rounded-md transition-fast hover:opacity-90 bg-accent text-bg-0"
            >
              Retry Now
            </button>
            <button
              onClick={() => {
                cancelPost(post.id);
                onClose();
              }}
              className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary transition-fast hover:bg-overlay"
            >
              Cancel Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ onAddChannel }: { onAddChannel: () => void }) {
  const { todaySlots, channels, activityFeed, dryRun, metricPoints, today, demoState } = useApp();
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  if (demoState === "loading") {
    return (
      <ScreenShell title="Mission Control" subtitle="Loading today's schedule…">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
            <RowSkeleton rows={5} />
          </div>
          <PanelSkeleton height={220} />
        </div>
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Mission Control" subtitle="Thursday, 20 December 2024">
        <ErrorBanner
          title="Zernio unreachable"
          detail="Could not read today's queue (503 after 3 attempts). Slots already pushed will still publish on Zernio's side; the console will resync once the API responds."
        />
      </ScreenShell>
    );
  }

  const scheduled = todaySlots.filter((s) => s.post.status === "scheduled").length;
  const published = todaySlots.filter((s) => s.post.status === "published").length;
  const failed = todaySlots.filter((s) => s.post.status === "failed").length;
  const activeChannels = channels.filter((c) => c.status === "active").length;

  const todayMetrics = metricPoints.filter((p) => p.date === today);
  const views24h = todayMetrics.reduce((sum, p) => sum + p.views, 0);
  const watchHours = todayMetrics.reduce((sum, p) => sum + p.watchTimeSec, 0) / 3600;
  const publishedThisWeek = metricPoints
    .filter((p) => p.date > "2024-12-13")
    .reduce((sum, p) => sum + p.videosPublished, 0);

  const openSlot = todaySlots.find((s) => s.post.id === openPostId) ?? null;

  // PRD §7.2 empty state — nothing to run until a channel exists.
  if (channels.length === 0) {
    return (
      <ScreenShell title="Mission Control">
        <EmptyState
          title="No channels configured"
          body="The scheduler has nothing to run. Add a channel to start distributing videos into daily slots."
          action={{ label: "Add your first channel", onClick: onAddChannel }}
        />
      </ScreenShell>
    );
  }

  const stats = [
    { label: "Scheduled Today", value: scheduled, tone: "text-text-secondary" },
    { label: "Published Today", value: published, tone: "text-success" },
    { label: "Failed", value: failed, tone: failed > 0 ? "text-danger" : "text-text-muted" },
    { label: "Active Channels", value: activeChannels, tone: "text-accent" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      {openSlot && <FailedDrawer slot={openSlot} onClose={() => setOpenPostId(null)} />}

      <div className="px-8 py-6 max-w-[1200px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Mission Control</h1>
            <div className="text-sm mt-0.5 text-text-muted">Thursday, 20 December 2024</div>
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono ${
              dryRun
                ? "border-accent/25 bg-accent/6 text-accent"
                : "border-border bg-surface-1 text-text-secondary"
            }`}
          >
            <span className={`status-dot ${dryRun ? "queued" : "active"}`} />
            {dryRun ? "Dry-run ON — no pushes to Zernio" : "Dry-run OFF — Live mode"}
          </div>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-4 gap-px mb-6 rounded-lg overflow-hidden border border-border bg-border">
          {stats.map((stat) => (
            <div key={stat.label} className="px-6 py-5 bg-surface-1">
              <div className={`font-mono text-stat font-medium mb-1 ${stat.tone}`}>
                {stat.value}
              </div>
              <div className="label-caps">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Today's timeline */}
          <div className="col-span-2 rounded-lg border border-border bg-surface-1">
            <div className="px-5 py-4 border-b border-border">
              <div className="label-caps">Today's Schedule</div>
            </div>
            {todaySlots.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-text-muted">
                Nothing scheduled for today
              </div>
            ) : (
              <div className="divide-y divide-border">
                {todaySlots.map((slot) => {
                  const isFailed = slot.post.status === "failed";
                  return (
                    <div
                      key={slot.post.id}
                      role={isFailed ? "button" : undefined}
                      tabIndex={isFailed ? 0 : undefined}
                      className={`flex items-center gap-4 px-5 py-3 transition-fast ${
                        isFailed
                          ? "cursor-pointer bg-danger/3 hover:bg-danger/8"
                          : "hover:bg-overlay-subtle"
                      }`}
                      onClick={() => isFailed && setOpenPostId(slot.post.id)}
                      onKeyDown={(e) => {
                        if (isFailed && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setOpenPostId(slot.post.id);
                        }
                      }}
                    >
                      <div className="font-mono text-xs w-20 flex-shrink-0 text-text-muted">
                        {slot.timeLabel}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate text-text-primary">{slot.video.title}</div>
                        <div className="text-xs mt-0.5 text-text-muted">{slot.channel.name}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <StatusDot status={slot.post.status} />
                        <span
                          className={`text-xs capitalize ${
                            isFailed ? "text-danger-text" : "text-text-muted"
                          }`}
                        >
                          {slot.post.status}
                        </span>
                      </div>
                      {isFailed && (
                        <div className="text-xs px-2 py-0.5 rounded bg-danger/12 text-danger-subtle">
                          View →
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Health panel */}
            <div className="rounded-lg border border-border bg-surface-1 p-5">
              <div className="label-caps mb-4">System Health</div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Last cron run</span>
                  <span className="font-mono text-xs text-success">00:00:12 UTC</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Last webhook</span>
                  <span className="font-mono text-xs text-text-primary">10:01:00 UTC</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Zernio</span>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status="active" />
                    <span className="text-xs text-success">Connected</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Storage (R2)</span>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status="active" />
                    <span className="text-xs text-success">Connected</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 flex items-center justify-between border-t border-border">
                  <span className="text-xs font-medium text-text-secondary">Dry-run mode</span>
                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono ${
                      dryRun ? "bg-accent/12 text-accent" : "bg-danger/12 text-danger-text"
                    }`}
                  >
                    {dryRun ? "ON" : "OFF"}
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics panel */}
            <div className="rounded-lg border border-border bg-surface-1 p-5">
              <div className="label-caps mb-4">24h Metrics</div>
              <div className="space-y-3">
                <div>
                  <div className="label-caps mb-1">Views</div>
                  <div className="font-mono text-metric text-text-primary">
                    {views24h.toLocaleString()}
                  </div>
                </div>
                <div className="pt-3 border-t border-border">
                  <div className="label-caps mb-1">Published This Week</div>
                  <div className="font-mono text-metric text-text-primary">{publishedThisWeek}</div>
                </div>
                <div className="pt-3 border-t border-border">
                  <div className="label-caps mb-1">Watch Time (hrs)</div>
                  <div className="font-mono text-metric text-text-primary">
                    {watchHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-4 rounded-lg border border-border bg-surface-1">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="label-caps">Recent Activity</div>
            <span className="text-xs text-text-muted">last 24 hours</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {activityFeed.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-4 px-5 py-3 hover:bg-overlay-subtle transition-fast"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    entry.status === "success"
                      ? "bg-success"
                      : entry.status === "failed"
                        ? "bg-danger"
                        : "bg-text-secondary"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary">
                    {entry.message}
                    {entry.videoTitle && (
                      <span className="text-text-muted"> — {entry.videoTitle}</span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5 text-text-muted">{entry.channel}</div>
                </div>
                <div className="font-mono text-xs flex-shrink-0 text-text-muted">
                  {utcTime(entry.timestamp)} UTC
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
