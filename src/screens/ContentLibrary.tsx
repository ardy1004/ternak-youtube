import { useState } from "react";
import { useApp, type Slot } from "../store/AppStore";
import type { Video, VideoStatus } from "../data/mock";
import { EmptyState, ErrorBanner, RowSkeleton, ScreenShell } from "../components/states";

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} />;
}

const statusOrder: Record<string, number> = {
  failed: 0, scheduled: 1, queued: 2, published: 3, draft: 4, cancelled: 5,
};

/** Every status in the enum gets a column — nothing disappears in board view. */
const kanbanColumns: VideoStatus[] = [
  "draft", "queued", "scheduled", "published", "failed", "cancelled",
];

function VideoDrawer({
  video,
  slot,
  onClose,
}: {
  video: Video;
  slot: Slot | undefined;
  onClose: () => void;
}) {
  const { channelById } = useApp();
  const channel = channelById(video.channelId);

  const history = [
    { time: video.createdAt.slice(0, 10), label: "Draft created" },
    ...(video.status !== "draft"
      ? [{ time: video.createdAt.slice(0, 10), label: "Queued for scheduling" }]
      : []),
    ...(slot ? [{ time: slot.localDate, label: "Slot assigned → Zernio push" }] : []),
    ...(video.status === "published" && slot
      ? [{ time: slot.localDate, label: "Published successfully" }]
      : []),
    ...(video.status === "failed" && slot
      ? [{ time: slot.localDate, label: slot.post.failReason ?? "Upload failed" }]
      : []),
    ...(video.status === "cancelled" && slot
      ? [{ time: slot.localDate, label: "Cancelled by operator" }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[520px] flex flex-col border-l border-border bg-surface-1 overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <span className="text-sm font-medium text-text-primary">Video Detail</span>
          <button
            onClick={onClose}
            aria-label="Close detail"
            className="text-xs hover:opacity-60 text-text-muted"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <img
            src={video.thumbnail}
            alt=""
            className="w-full rounded-md object-cover bg-surface-2"
            style={{ height: "160px" }}
          />

          <div>
            <div className="label-caps mb-1">Selected Title</div>
            <div className="text-sm font-medium text-text-primary">{video.title}</div>
          </div>

          {video.titleVariants.length > 0 && (
            <div>
              <div className="label-caps mb-2">Title Variants</div>
              <div className="space-y-1.5">
                {video.titleVariants.map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="font-mono text-xs mt-0.5 text-text-muted">{i + 1}.</span>
                    <div className="text-xs text-text-secondary">{t}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label-caps mb-1">Channel</div>
              <div className="text-xs text-text-secondary">{channel?.name}</div>
            </div>
            <div>
              <div className="label-caps mb-1">Status</div>
              <div className="flex items-center gap-1.5">
                <StatusDot status={video.status} />
                <span className="text-xs capitalize text-text-secondary">{video.status}</span>
              </div>
            </div>
            <div>
              <div className="label-caps mb-1">Type × Market</div>
              <div className="text-xs text-text-secondary">
                {video.type} × {video.market}
              </div>
            </div>
            <div>
              <div className="label-caps mb-1">Scheduled Slot</div>
              <div
                className={`font-mono text-xs ${slot ? "text-text-secondary" : "text-text-muted"}`}
              >
                {slot ? `${slot.localDate} ${slot.timeLabel}` : "—"}
              </div>
            </div>
          </div>

          {slot?.post.zernioPostId && (
            <div>
              <div className="label-caps mb-1">Zernio Post ID</div>
              <div className="font-mono text-xs text-text-muted">{slot.post.zernioPostId}</div>
            </div>
          )}

          <div>
            <div className="label-caps mb-1">Brief</div>
            <div className="text-xs text-text-secondary leading-relaxed">{video.brief}</div>
          </div>

          {video.description && (
            <div>
              <div className="label-caps mb-1">Description</div>
              <div className="text-xs whitespace-pre-line text-text-secondary leading-relaxed">
                {video.description}
              </div>
            </div>
          )}

          {video.tags.length > 0 && (
            <div>
              <div className="label-caps mb-2">Tags</div>
              <div className="flex flex-wrap gap-1">
                {video.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 rounded font-mono bg-surface-2 text-text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="label-caps mb-2">Status History</div>
            <div className="space-y-1.5">
              {history.map((ev, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="font-mono text-xs flex-shrink-0 w-20 text-text-muted">
                    {ev.time}
                  </div>
                  <div className="text-xs text-text-secondary">{ev.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ContentLibrary({ onUpload }: { onUpload: () => void }) {
  const { videos, channels, slots, demoState } = useApp();
  const [view, setView] = useState<"table" | "kanban">("table");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterMarket, setFilterMarket] = useState<string>("all");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  if (demoState === "loading") {
    return (
      <ScreenShell title="Content Library" subtitle="Loading video pool…">
        <RowSkeleton rows={7} showThumb />
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Content Library">
        <ErrorBanner
          title="Could not load the video pool"
          detail="Metadata query failed. Uploads already in R2 are safe — only this listing is unavailable."
        />
      </ScreenShell>
    );
  }

  if (videos.length === 0) {
    return (
      <ScreenShell title="Content Library">
        <EmptyState
          title="No videos in the pool"
          body="Upload a video and write a one-line brief. The AI drafts the metadata, then the daily cron assigns it a slot."
          action={{ label: "Upload video", onClick: onUpload }}
        />
      </ScreenShell>
    );
  }

  const slotForVideo = (videoId: string) =>
    slots.find((s) => s.video.id === videoId && s.post.status !== "cancelled") ??
    slots.find((s) => s.video.id === videoId);

  const filtered = videos
    .filter((v) => filterStatus === "all" || v.status === filterStatus)
    .filter((v) => filterChannel === "all" || v.channelId === filterChannel)
    .filter((v) => filterMarket === "all" || v.market === filterMarket)
    .sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

  const selectedVideo = videos.find((v) => v.id === selectedVideoId);
  const selectClass =
    "px-3 py-1.5 rounded-md border border-border bg-surface-1 text-text-secondary text-xs outline-none";

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      {selectedVideo && (
        <VideoDrawer
          video={selectedVideo}
          slot={slotForVideo(selectedVideo.id)}
          onClose={() => setSelectedVideoId(null)}
        />
      )}

      <div className="px-8 py-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Content Library</h1>
            <div className="text-sm mt-0.5 text-text-muted">
              <span className="font-mono">{filtered.length}</span>
              {filtered.length === videos.length ? " videos total" : ` of ${videos.length} videos`}
            </div>
          </div>
          <button
            onClick={onUpload}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-fast hover:opacity-90 bg-accent text-bg-0"
          >
            + Upload Video
          </button>
        </div>

        {/* Filters + View Toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              aria-label="Filter by channel"
              className={selectClass}
            >
              <option value="all">All Channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filter by status"
              className={selectClass}
            >
              <option value="all">All Status</option>
              {kanbanColumns.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <select
              value={filterMarket}
              onChange={(e) => setFilterMarket(e.target.value)}
              aria-label="Filter by market"
              className={selectClass}
            >
              <option value="all">All Markets</option>
              <option value="Indonesia">Indonesia</option>
              <option value="Malaysia">Malaysia</option>
              <option value="International">International</option>
            </select>
          </div>

          <div className="flex rounded-md border border-border overflow-hidden">
            {(["table", "kanban"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs capitalize transition-fast ${
                  view === v ? "bg-border text-text-primary" : "bg-surface-1 text-text-muted"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Table View */}
        {view === "table" && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-1 border-b border-border">
                  {["", "Title", "Channel", "Type × Market", "Status", "Scheduled Slot", ""].map(
                    (h, i) => (
                      <th key={i} className="px-4 py-3 text-left label-caps font-medium">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((video) => {
                  const channel = channels.find((c) => c.id === video.channelId);
                  const slot = slotForVideo(video.id);
                  return (
                    <tr
                      key={video.id}
                      tabIndex={0}
                      className="border-t border-border-subtle bg-surface-1 cursor-pointer hover:bg-overlay-subtle transition-fast"
                      onClick={() => setSelectedVideoId(video.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedVideoId(video.id);
                        }
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <img
                          src={video.thumbnail}
                          alt=""
                          className="w-16 h-9 rounded object-cover bg-surface-2"
                        />
                      </td>
                      <td className="px-4 py-2.5 max-w-[280px]">
                        <div className="text-xs font-medium truncate text-text-primary">
                          {video.title}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs text-text-secondary">{channel?.name}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-mono text-text-muted">
                          {video.type} × {video.market}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusDot status={video.status} />
                          <span className="text-xs capitalize text-text-secondary">
                            {video.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs text-text-muted">
                          {slot ? `${slot.localDate.slice(5)} ${slot.timeLabel}` : "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          className="text-xs px-2 py-1 rounded border border-border text-text-muted transition-fast hover:bg-overlay"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVideoId(video.id);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-sm bg-surface-1 text-text-muted">
                No videos match the current filters
              </div>
            )}
          </div>
        )}

        {/* Kanban View */}
        {view === "kanban" && (
          <div className="grid grid-cols-6 gap-3">
            {kanbanColumns.map((col) => {
              const colVideos = filtered.filter((v) => v.status === col);
              return (
                <div key={col}>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusDot status={col} />
                    <span className="text-xs font-medium capitalize text-text-secondary">
                      {col}
                    </span>
                    <span className="font-mono text-xs ml-auto text-text-muted">
                      {colVideos.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {colVideos.map((video) => {
                      const channel = channels.find((c) => c.id === video.channelId);
                      return (
                        <div
                          key={video.id}
                          role="button"
                          tabIndex={0}
                          className="p-2.5 rounded-md border border-border bg-surface-1 cursor-pointer hover:border-border-hover transition-fast"
                          onClick={() => setSelectedVideoId(video.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedVideoId(video.id);
                            }
                          }}
                        >
                          <img
                            src={video.thumbnail}
                            alt=""
                            className="w-full rounded mb-2 object-cover bg-surface-2"
                            style={{ height: "48px" }}
                          />
                          <div className="text-xs font-medium leading-snug text-text-primary">
                            {video.title.length > 48 ? video.title.slice(0, 48) + "…" : video.title}
                          </div>
                          <div className="text-xs mt-1 text-text-muted">{channel?.name}</div>
                        </div>
                      );
                    })}
                    {colVideos.length === 0 && (
                      <div className="p-3 rounded-md border border-dashed border-border text-xs text-center text-text-muted">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
