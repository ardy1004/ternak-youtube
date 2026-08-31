import { useState } from "react";
import { useApp } from "../store/AppStore";
import { JOB_TYPE_COLOR, VAR } from "../lib/tokens";
import { utcStamp } from "../lib/datetime";
import { ErrorBanner, RowSkeleton, ScreenShell } from "../components/states";

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} />;
}

const selectClass =
  "px-3 py-1.5 rounded-md border border-border bg-surface-1 text-text-secondary text-xs outline-none";

export default function ActivityLogs() {
  const { activityFeed, jobRuns, webhookEvents, demoState } = useApp();
  const [tab, setTab] = useState<"activity" | "jobs" | "webhooks">("activity");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");

  if (demoState === "loading") {
    return (
      <ScreenShell title="Activity & Logs" subtitle="Reading audit trail…">
        <RowSkeleton rows={8} />
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Activity & Logs">
        <ErrorBanner
          title="Dead-man's-switch tripped"
          detail="No cron run recorded in the last 26 hours and the job log is unreadable. Publishing may have stopped — check the worker before assuming the queue is healthy."
        />
      </ScreenShell>
    );
  }

  const activityTypes = [...new Set(activityFeed.map((e) => e.type))].sort();

  const filteredActivity = activityFeed.filter((e) => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterType !== "all" && e.type !== filterType) return false;
    return true;
  });

  const dotClass = (status: string) =>
    status === "success" ? "bg-success" : status === "failed" ? "bg-danger" : "bg-text-secondary";

  const textClass = (status: string) =>
    status === "success"
      ? "text-success"
      : status === "failed"
        ? "text-danger"
        : "text-text-secondary";

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Activity &amp; Logs</h1>
            <div className="text-sm mt-0.5 text-text-muted">
              Job runs, webhook events, and audit trail
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border bg-surface-2 text-success">
            <span className="status-dot active" />
            Dead-man's-switch: OK — cron ran 6h ago
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border pb-0">
          {(
            [
              ["activity", "Activity Feed"],
              ["jobs", "Job Runs"],
              ["webhooks", "Webhook Events"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm relative transition-fast -mb-px border-b-2 ${
                tab === key
                  ? "text-text-primary border-accent"
                  : "text-text-muted border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Activity Feed */}
        {tab === "activity" && (
          <>
            <div className="flex gap-2 mb-4">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="Filter by status"
                className={selectClass}
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="info">Info</option>
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                aria-label="Filter by type"
                className={selectClass}
              >
                <option value="all">All Types</option>
                {activityTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="divide-y divide-border-subtle">
                {filteredActivity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-4 px-5 py-3.5 bg-surface-1 hover:bg-overlay-subtle transition-fast"
                  >
                    <div className="flex items-center gap-2 pt-0.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass(entry.status)}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-surface-2 text-text-muted">
                          {entry.type}
                        </span>
                        <span className="text-xs text-text-primary">{entry.message}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-text-muted">{entry.channel}</span>
                        {entry.videoTitle && (
                          <span className="text-xs truncate max-w-[300px] text-text-muted">
                            · {entry.videoTitle}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="font-mono text-xs flex-shrink-0 text-text-muted">
                      {utcStamp(entry.timestamp)} UTC
                    </div>
                  </div>
                ))}
              </div>
              {filteredActivity.length === 0 && (
                <div className="py-12 text-center text-sm bg-surface-1 text-text-muted">
                  No entries match the current filters
                </div>
              )}
            </div>
          </>
        )}

        {/* Job Runs */}
        {tab === "jobs" && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-1 border-b border-border">
                  <th className="px-5 py-3 text-left label-caps">Job Type</th>
                  <th className="px-4 py-3 text-left label-caps">Status</th>
                  <th className="px-4 py-3 text-left label-caps">Started</th>
                  <th className="px-4 py-3 text-left label-caps">Duration</th>
                  <th className="px-4 py-3 text-left label-caps">Detail</th>
                </tr>
              </thead>
              <tbody>
                {jobRuns.map((job) => {
                  const dur = Math.round(
                    (new Date(job.finished).getTime() - new Date(job.started).getTime()) / 1000
                  );
                  return (
                    <tr
                      key={job.id}
                      className="border-t border-border-subtle bg-surface-1 hover:bg-overlay-subtle transition-fast"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: JOB_TYPE_COLOR[job.type] ?? VAR.textMuted }}
                          />
                          <span className="font-mono text-xs text-text-primary">{job.type}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusDot status={job.status === "success" ? "published" : "failed"} />
                          <span className={`text-xs capitalize ${textClass(job.status)}`}>
                            {job.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-text-muted">
                          {utcStamp(job.started)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-text-secondary">{dur}s</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-text-muted">{job.detail}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {jobRuns.length === 0 && (
              <div className="py-12 text-center text-sm bg-surface-1 text-text-muted">
                No job runs recorded yet
              </div>
            )}
          </div>
        )}

        {/* Webhook Events */}
        {tab === "webhooks" && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-1 border-b border-border">
                  <th className="px-5 py-3 text-left label-caps">Event Type</th>
                  <th className="px-4 py-3 text-left label-caps">Source</th>
                  <th className="px-4 py-3 text-left label-caps">Channel</th>
                  <th className="px-4 py-3 text-left label-caps">Status</th>
                  <th className="px-4 py-3 text-left label-caps">Received</th>
                </tr>
              </thead>
              <tbody>
                {webhookEvents.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-t border-border-subtle bg-surface-1 hover:bg-overlay-subtle transition-fast"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs text-text-primary">{ev.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-text-secondary">{ev.source}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-text-muted">{ev.channel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusDot
                          status={
                            ev.status === "success"
                              ? "published"
                              : ev.status === "failed"
                                ? "failed"
                                : "scheduled"
                          }
                        />
                        <span className={`text-xs capitalize ${textClass(ev.status)}`}>
                          {ev.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-text-muted">
                        {utcStamp(ev.timestamp)} UTC
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {webhookEvents.length === 0 && (
              <div className="py-12 text-center text-sm bg-surface-1 text-text-muted">
                No webhook events received yet
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
