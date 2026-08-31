import { useApp } from "../store/AppStore";
import type { Channel } from "../data/mock";
import { tzAbbr } from "../lib/datetime";
import { EmptyState, ErrorBanner, RowSkeleton, ScreenShell } from "../components/states";

interface ChannelsProps {
  onAddChannel: () => void;
  onEditChannel: (channelId: string) => void;
}

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} />;
}

function ChannelCard({
  channel,
  scheduledCount,
  onToggle,
  onEdit,
}: {
  channel: Channel;
  scheduledCount: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const isActive = channel.status === "active";
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-5 flex flex-col gap-4 hover:border-border-hover transition-fast">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-sm text-text-primary">{channel.name}</div>
          <div className="text-xs mt-0.5 font-mono text-text-muted">{channel.handle}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={channel.status} />
          <span className={`text-xs capitalize ${isActive ? "text-success" : "text-warning"}`}>
            {channel.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label-caps mb-1">Market</div>
          <div className="text-xs text-text-secondary">{channel.market}</div>
        </div>
        <div>
          <div className="label-caps mb-1">Niche</div>
          <div className="text-xs text-text-secondary">{channel.niche}</div>
        </div>
        <div>
          <div className="label-caps mb-1">Scheduled</div>
          <div className="font-mono text-sm text-text-primary">{scheduledCount}</div>
        </div>
        <div>
          <div className="label-caps mb-1">Weekly Views</div>
          <div className="font-mono text-sm text-text-primary">
            {channel.weeklyViews.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border flex items-center justify-between">
        <div className="flex gap-1">
          <span className="text-xs px-2 py-0.5 rounded font-mono bg-surface-2 text-text-secondary">
            {channel.videosPerDay}v/day
          </span>
          <span className="text-xs px-2 py-0.5 rounded font-mono bg-surface-2 text-text-secondary">
            {tzAbbr(channel.timezone)}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded border border-border text-text-secondary transition-fast hover:bg-overlay"
          >
            Edit
          </button>
          <button
            onClick={onToggle}
            className={`text-xs px-2 py-1 rounded border border-border transition-fast hover:bg-overlay ${
              isActive ? "text-warning" : "text-success"
            }`}
          >
            {isActive ? "Pause" : "Resume"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Channels({ onAddChannel, onEditChannel }: ChannelsProps) {
  const { channels, slots, toggleChannelStatus, demoState } = useApp();

  if (demoState === "loading") {
    return (
      <ScreenShell title="Channels" subtitle="Loading channel configuration…">
        <RowSkeleton rows={4} />
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Channels">
        <ErrorBanner
          title="Could not load channels"
          detail="The configuration store did not respond. Existing schedules are unaffected — this screen only reads channel settings."
        />
      </ScreenShell>
    );
  }

  const activeCount = channels.filter((c) => c.status === "active").length;
  const pausedCount = channels.filter((c) => c.status === "paused").length;

  const scheduledPerChannel = (channelId: string) =>
    slots.filter((s) => s.channel.id === channelId && s.post.status === "scheduled").length;

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Channels</h1>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <StatusDot status="active" />
                <span className="font-mono">{activeCount}</span> active
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <StatusDot status="paused" />
                <span className="font-mono">{pausedCount}</span> paused
              </div>
            </div>
          </div>
          <button
            onClick={onAddChannel}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-fast hover:opacity-90 bg-accent text-bg-0"
          >
            <span>+</span> Add Channel
          </button>
        </div>

        {channels.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                scheduledCount={scheduledPerChannel(channel.id)}
                onToggle={() => toggleChannelStatus(channel.id)}
                onEdit={() => onEditChannel(channel.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No channels yet"
            body="Add your first YouTube channel to start scheduling. Nothing publishes until a channel exists and is active."
            action={{ label: "Add Channel", onClick: onAddChannel }}
          />
        )}
      </div>
    </div>
  );
}
