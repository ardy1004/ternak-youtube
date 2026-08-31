import { useState } from "react";
import { useApp, type Slot } from "../store/AppStore";
import { VAR, channelColor } from "../lib/tokens";
import { EmptyState, ErrorBanner, PanelSkeleton, ScreenShell } from "../components/states";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const WEEK_HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 06:00 – 21:00

const MONTH = "2024-12";
const TODAY_DAY = 20;
/** December 2024 starts on a Sunday, so a Monday-first grid needs 6 blanks. */
const LEADING_BLANKS = 6;

const dateOf = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}`;
/** Monday = 0. */
const weekdayIndex = (day: number) => (5 + day) % 7;

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} />;
}

function isMovable(slot: Slot) {
  return slot.post.status === "scheduled" || slot.post.status === "failed";
}

export default function Schedule() {
  const { slots, channels, cancelPost, reschedulePost, demoState } = useApp();
  const [view, setView] = useState<"month" | "week">("month");
  const [selectedDay, setSelectedDay] = useState<number | null>(TODAY_DAY);
  const [dragOver, setDragOver] = useState<string | null>(null);

  if (demoState === "loading") {
    return (
      <ScreenShell title="Schedule" subtitle="Loading calendar…">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <PanelSkeleton height={420} />
          </div>
          <PanelSkeleton height={420} />
        </div>
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Schedule">
        <ErrorBanner
          title="Schedule out of sync"
          detail="Reconciliation with Zernio failed, so the calendar may be stale. Avoid rescheduling until the next successful sync."
        />
      </ScreenShell>
    );
  }

  if (slots.length === 0) {
    return (
      <ScreenShell title="Schedule" subtitle="December 2024">
        <EmptyState
          title="Nothing scheduled"
          body="Once videos are queued and a channel is active, the daily cron distributes them into slots and they appear here."
        />
      </ScreenShell>
    );
  }

  const channelIds = channels.map((c) => c.id);
  const colorFor = (id: string) => channelColor(id, channelIds);

  const live = slots.filter((s) => s.post.status !== "cancelled");
  const slotsOnDay = (day: number) => live.filter((s) => s.localDate === dateOf(day));

  const dayEntries = selectedDay ? slotsOnDay(selectedDay) : [];
  const conflicts = live.filter((s) => s.conflict);
  const upcoming = live.filter((s) => s.localDate >= dateOf(TODAY_DAY));

  const weekStart = selectedDay
    ? selectedDay - weekdayIndex(selectedDay)
    : TODAY_DAY - weekdayIndex(TODAY_DAY);
  const weekDayNumbers = Array.from({ length: 7 }, (_, i) => weekStart + i).filter(
    (d) => d >= 1 && d <= 31
  );

  const onDragStart = (e: React.DragEvent, slot: Slot) => {
    if (!isMovable(slot)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", slot.post.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropTo = (e: React.DragEvent, day: number, hour?: number) => {
    e.preventDefault();
    setDragOver(null);
    const postId = e.dataTransfer.getData("text/plain");
    if (!postId) return;
    reschedulePost(
      postId,
      dateOf(day),
      hour === undefined ? undefined : `${String(hour).padStart(2, "0")}:00`
    );
  };

  const allowDrop = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(key);
  };

  const weekGridCols = { gridTemplateColumns: `36px repeat(${weekDayNumbers.length}, 1fr)` };

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Schedule</h1>
            <div className="text-sm mt-0.5 text-text-muted">
              December 2024 · drag an entry to reschedule
            </div>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["month", "week"] as const).map((v) => (
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

        {conflicts.length > 0 && (
          <div className="mb-4 px-4 py-3 rounded-lg border border-warning/25 bg-warning/6 flex items-center gap-3">
            <span className="status-dot paused" />
            <div className="text-xs text-warning">
              <span className="font-mono">{conflicts.length}</span> slot conflict
              {conflicts.length > 1 ? "s" : ""} — two posts share the same channel and time.
              Reschedule one before the next cron run.
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {/* Calendar */}
          <div className="col-span-2 rounded-lg border border-border bg-surface-1 overflow-hidden">
            {view === "month" ? (
              <div className="grid grid-cols-7 border-b border-border">
                {WEEK_DAYS.map((d) => (
                  <div key={d} className="py-2 text-center label-caps" style={{ fontSize: "10px" }}>
                    {d}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid border-b border-border" style={weekGridCols}>
                <div />
                {weekDayNumbers.map((day) => (
                  <div
                    key={`dow_${day}`}
                    className="py-2 text-center label-caps"
                    style={{ fontSize: "10px" }}
                  >
                    {WEEK_DAYS[weekdayIndex(day)]}
                  </div>
                ))}
              </div>
            )}

            {view === "month" && (
              <div className="grid grid-cols-7">
                {Array.from({ length: LEADING_BLANKS }).map((_, i) => (
                  <div key={`empty_${i}`} className="h-16 border-b border-r border-surface-2" />
                ))}
                {MONTH_DAYS.map((day) => {
                  const entries = slotsOnDay(day);
                  const isSelected = selectedDay === day;
                  const isToday = day === TODAY_DAY;
                  const key = `m_${day}`;
                  const isDropTarget = dragOver === key;
                  return (
                    <div
                      key={day}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedDay(day === selectedDay ? null : day);
                        }
                      }}
                      onDragOver={(e) => allowDrop(e, key)}
                      onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                      onDrop={(e) => onDropTo(e, day)}
                      className={`h-16 border-b border-r p-1.5 cursor-pointer transition-fast ${
                        isDropTarget
                          ? "border-accent bg-accent/10"
                          : `border-surface-2 hover:bg-overlay-subtle ${
                              isSelected ? "bg-accent/6" : ""
                            }`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`font-mono text-xs w-5 h-5 flex items-center justify-center rounded-full ${
                            isToday ? "bg-accent text-bg-0" : "text-text-secondary"
                          }`}
                        >
                          {day}
                        </span>
                        {entries.length > 0 && (
                          <span className="font-mono text-xs text-accent">{entries.length}</span>
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {entries.slice(0, 2).map((s) => (
                          <div
                            key={s.post.id}
                            draggable={isMovable(s)}
                            onDragStart={(e) => onDragStart(e, s)}
                            className="h-1 rounded-full opacity-80"
                            style={{
                              background: s.conflict ? VAR.warning : colorFor(s.channel.id),
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === "week" && (
              <div className="overflow-y-auto" style={{ maxHeight: "480px" }}>
                <div className="grid" style={weekGridCols}>
                  {WEEK_HOURS.map((hour) => (
                    <div key={`row_${hour}`} className="contents">
                      <div className="border-b border-r border-surface-2 flex items-start justify-end pr-1.5 pt-1">
                        <span className="font-mono text-xs text-text-muted">
                          {String(hour).padStart(2, "0")}
                        </span>
                      </div>
                      {weekDayNumbers.map((day) => {
                        const key = `w_${day}_${hour}`;
                        const entries = slotsOnDay(day).filter((s) => s.hour === hour);
                        return (
                          <div
                            key={key}
                            onDragOver={(e) => allowDrop(e, key)}
                            onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                            onDrop={(e) => onDropTo(e, day, hour)}
                            className={`border-b border-r p-1 space-y-1 transition-fast ${
                              dragOver === key ? "border-accent bg-accent/10" : "border-surface-2"
                            }`}
                            style={{ minHeight: "34px" }}
                          >
                            {entries.map((s) => (
                              <div
                                key={s.post.id}
                                draggable={isMovable(s)}
                                onDragStart={(e) => onDragStart(e, s)}
                                title={`${s.timeLabel} · ${s.video.title} · ${s.channel.name}`}
                                className={`px-1.5 py-0.5 rounded text-xs truncate cursor-grab active:cursor-grabbing text-text-secondary ${
                                  s.conflict ? "bg-warning/20" : "bg-surface-2"
                                }`}
                                style={{
                                  borderLeft: `2px solid ${
                                    s.conflict ? VAR.warning : colorFor(s.channel.id)
                                  }`,
                                }}
                              >
                                {s.video.title}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Queue list */}
          <div className="rounded-lg border border-border bg-surface-1 flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <div className="label-caps">
                {selectedDay ? `Dec ${selectedDay} — Queue` : "Select a day"}
              </div>
            </div>

            {!selectedDay && (
              <div className="flex-1 flex items-center justify-center text-xs px-4 text-center text-text-muted">
                Click a date to see its schedule
              </div>
            )}

            {selectedDay && dayEntries.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-xs px-4 text-center text-text-muted">
                No posts scheduled
              </div>
            )}

            <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
              {dayEntries.map((slot) => (
                <div
                  key={slot.post.id}
                  draggable={isMovable(slot)}
                  onDragStart={(e) => onDragStart(e, slot)}
                  className={`px-4 py-3 ${
                    isMovable(slot) ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <div
                        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: colorFor(slot.channel.id) }}
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-xs mb-0.5 text-text-muted">
                          {slot.timeLabel}
                        </div>
                        <div className="text-xs font-medium leading-snug text-text-primary">
                          {slot.video.title.length > 50
                            ? slot.video.title.slice(0, 50) + "…"
                            : slot.video.title}
                        </div>
                        <div className="text-xs mt-0.5 text-text-muted">{slot.channel.name}</div>
                        {slot.conflict && (
                          <div className="text-xs mt-1 text-warning">Slot conflict</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StatusDot status={slot.post.status} />
                      {slot.post.status !== "published" && (
                        <button
                          onClick={() => cancelPost(slot.post.id)}
                          className="text-xs transition-fast hover:opacity-70 text-text-muted"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Channel legend */}
            <div className="px-4 py-3 border-t border-border space-y-1.5">
              <div className="label-caps mb-2">Channels</div>
              {channels
                .filter((c) => c.status === "active")
                .map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: colorFor(c.id) }}
                    />
                    <span className="text-xs text-text-secondary">{c.name}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Upcoming queue list */}
        <div className="mt-4 rounded-lg border border-border bg-surface-1">
          <div className="px-5 py-4 border-b border-border">
            <div className="label-caps">Upcoming — Next 7 Days</div>
          </div>
          {upcoming.length === 0 ? (
            <div className="py-10 text-center text-sm text-text-muted">Nothing scheduled ahead</div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {upcoming.slice(0, 12).map((slot) => (
                <div
                  key={slot.post.id}
                  draggable={isMovable(slot)}
                  onDragStart={(e) => onDragStart(e, slot)}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-overlay-subtle transition-fast"
                >
                  <div className="font-mono text-xs w-28 flex-shrink-0 text-text-muted">
                    Dec {slot.dayOfMonth} · {slot.timeLabel}
                  </div>
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: colorFor(slot.channel.id) }}
                  />
                  <div className="flex-1 text-xs truncate text-text-primary">
                    {slot.video.title}
                  </div>
                  <div className="text-xs flex-shrink-0 text-text-muted">{slot.channel.name}</div>
                  <StatusDot status={slot.post.status} />
                  {slot.post.status !== "published" && (
                    <button
                      onClick={() => cancelPost(slot.post.id)}
                      className="text-xs px-2 py-1 rounded border border-border text-text-muted transition-fast hover:bg-overlay"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
