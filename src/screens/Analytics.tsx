import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp } from "../store/AppStore";
import { CHART } from "../lib/tokens";
import { EmptyState, ErrorBanner, PanelSkeleton, RowSkeleton, ScreenShell } from "../components/states";

/** PRD F8 — YouTube analytics lag 24–48h, so the newest days are provisional. */
const PROVISIONAL_DAYS = 2;

const RANGES: [string, string, number][] = [
  ["3d", "Last 3 days", 3],
  ["7d", "Last 7 days", 7],
  ["all", "All time", Infinity],
];

function CustomTooltip({
  active,
  payload,
  label,
  provisional,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  provisional: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-md border border-border bg-surface-2 text-xs">
      <div className="font-mono mb-1 text-text-muted">
        {label}
        {label && provisional.has(label) && <span className="text-warning"> · provisional</span>}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-text-secondary">{p.name}:</span>
          <span className="font-mono text-text-primary">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { metricPoints, channels, demoState } = useApp();
  const [metric, setMetric] = useState<"views" | "watchTime">("views");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterMarket, setFilterMarket] = useState("all");
  const [range, setRange] = useState("7d");

  const allDates = useMemo(
    () => [...new Set(metricPoints.map((p) => p.date))].sort(),
    [metricPoints]
  );

  const contentTypes = useMemo(
    () => [...new Set(metricPoints.map((p) => p.contentType))].sort(),
    [metricPoints]
  );
  const markets = useMemo(
    () => [...new Set(metricPoints.map((p) => p.market))].sort(),
    [metricPoints]
  );

  const provisional = useMemo(() => new Set(allDates.slice(-PROVISIONAL_DAYS)), [allDates]);

  const filtered = useMemo(() => {
    const days = RANGES.find(([id]) => id === range)?.[2] ?? Infinity;
    const cutoff = Number.isFinite(days) ? allDates.slice(-days) : allDates;
    const inRange = new Set(cutoff);
    return metricPoints.filter(
      (p) =>
        inRange.has(p.date) &&
        (filterChannel === "all" || p.channelId === filterChannel) &&
        (filterType === "all" || p.contentType === filterType) &&
        (filterMarket === "all" || p.market === filterMarket)
    );
  }, [metricPoints, allDates, range, filterChannel, filterType, filterMarket]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, p) => ({
          views: acc.views + p.views,
          watchHours: acc.watchHours + p.watchTimeSec / 3600,
          videos: acc.videos + p.videosPublished,
        }),
        { views: 0, watchHours: 0, videos: 0 }
      ),
    [filtered]
  );

  const metricLabel = metric === "views" ? "Views" : "Watch Time (hrs)";

  const chartData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const p of filtered) {
      const value = metric === "views" ? p.views : p.watchTimeSec / 3600;
      byDate.set(p.date, (byDate.get(p.date) ?? 0) + value);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date: date.slice(5).replace("-", "/"),
        rawDate: date,
        [metricLabel]: Math.round(value * 10) / 10,
      }));
  }, [filtered, metric, metricLabel]);

  const provisionalLabels = useMemo(
    () => new Set(chartData.filter((d) => provisional.has(d.rawDate)).map((d) => d.date)),
    [chartData, provisional]
  );

  const segments = useMemo(() => {
    const byKey = new Map<
      string,
      { segment: string; views: number; watchHours: number; videos: number }
    >();
    for (const p of filtered) {
      const key = `${p.contentType} × ${p.market}`;
      const row = byKey.get(key) ?? { segment: key, views: 0, watchHours: 0, videos: 0 };
      row.views += p.views;
      row.watchHours += p.watchTimeSec / 3600;
      row.videos += p.videosPublished;
      byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => b.views - a.views);
  }, [filtered]);

  const filterConfigs = [
    {
      label: "Content Type",
      value: filterType,
      onChange: setFilterType,
      options: [["all", "All Types"], ...contentTypes.map((t) => [t, t])] as [string, string][],
    },
    {
      label: "Market",
      value: filterMarket,
      onChange: setFilterMarket,
      options: [["all", "All Markets"], ...markets.map((m) => [m, m])] as [string, string][],
    },
    {
      label: "Channel",
      value: filterChannel,
      onChange: setFilterChannel,
      options: [["all", "All Channels"], ...channels.map((c) => [c.id, c.name])] as [
        string,
        string,
      ][],
    },
    {
      label: "Range",
      value: range,
      onChange: setRange,
      options: RANGES.map(([id, label]) => [id, label]) as [string, string][],
    },
  ];

  // Declared after every hook so the hook order stays stable across states.
  if (demoState === "loading") {
    return (
      <ScreenShell title="Analytics" subtitle="Pulling metric snapshots…">
        <PanelSkeleton height={280} />
        <div className="mt-4">
          <RowSkeleton rows={5} />
        </div>
      </ScreenShell>
    );
  }

  if (demoState === "error") {
    return (
      <ScreenShell title="Analytics">
        <ErrorBanner
          title="Analytics sync failed"
          detail="The last daily pull did not complete, so these numbers would be stale. Nothing is lost — snapshots are append-only and the next run backfills."
        />
      </ScreenShell>
    );
  }

  if (metricPoints.length === 0) {
    return (
      <ScreenShell title="Analytics">
        <EmptyState
          title="No metrics yet"
          body="Snapshots start accumulating once videos publish. Expect the first numbers 24–48 hours after the first upload goes live."
        />
      </ScreenShell>
    );
  }

  const selectClass =
    "px-3 py-1.5 rounded-md border border-border bg-surface-1 text-text-secondary text-xs outline-none";

  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-text-primary">Analytics</h1>
            <div className="text-sm mt-0.5 text-text-muted">Performance by content segment</div>
          </div>
          <div className="text-xs px-3 py-1.5 rounded-md border border-border bg-surface-2 text-warning">
            Data lags 24–48 hrs · Last sync: Dec 20, 12:00 UTC
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {filterConfigs.map((filter) => (
            <select
              key={filter.label}
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              aria-label={filter.label}
              className={selectClass}
            >
              {filter.options.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          ))}
        </div>

        {segments.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-1 py-20 text-center">
            <div className="text-sm text-text-secondary">No data for this combination</div>
            <div className="text-xs mt-1 text-text-muted">Widen the range or clear a filter</div>
          </div>
        ) : (
          <>
            {/* Summary numbers */}
            <div className="grid grid-cols-3 gap-px mb-5 rounded-lg overflow-hidden border border-border bg-border">
              {[
                { label: "Total Views", value: totals.views.toLocaleString() },
                {
                  label: "Total Watch Time",
                  value: `${Math.round(totals.watchHours).toLocaleString()} hrs`,
                },
                { label: "Videos Published", value: String(totals.videos) },
              ].map((s) => (
                <div key={s.label} className="px-6 py-4 bg-surface-1">
                  <div className="label-caps mb-1">{s.label}</div>
                  <div className="font-mono text-metric text-text-primary">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="rounded-lg border border-border bg-surface-1 mb-4">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-4">
                  <div className="label-caps">Trend</div>
                  <div className="flex rounded border border-border overflow-hidden">
                    {(["views", "watchTime"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMetric(m)}
                        className={`px-3 py-1 text-xs transition-fast ${
                          metric === m
                            ? "bg-border text-text-primary"
                            : "bg-surface-1 text-text-muted"
                        }`}
                      >
                        {m === "views" ? "Views" : "Watch Time"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="font-mono text-sm text-accent">
                  {metric === "views"
                    ? totals.views.toLocaleString()
                    : Math.round(totals.watchHours).toLocaleString()}
                  <span className="text-xs ml-1 text-text-muted">
                    {metric === "views" ? "total views" : "total hrs"}
                  </span>
                </div>
              </div>
              <div className="px-4 py-4" style={{ height: "240px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: CHART.axis, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: CHART.axis, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                      width={40}
                    />
                    <Tooltip content={<CustomTooltip provisional={provisionalLabels} />} />
                    <Line
                      type="monotone"
                      dataKey={metricLabel}
                      stroke={CHART.accent}
                      strokeWidth={1.5}
                      dot={{ fill: CHART.accent, r: 3, strokeWidth: 0 }}
                      activeDot={{ fill: CHART.accent, r: 4, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="px-5 py-2.5 border-t border-border text-xs flex items-center gap-2 text-text-muted">
                <span className="status-dot queued" />
                Provisional (still settling):{" "}
                <span className="font-mono text-warning">
                  {[...provisionalLabels].join(", ") || "none in range"}
                </span>
              </div>
            </div>

            {/* Segment table */}
            <div className="rounded-lg border border-border bg-surface-1">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div className="label-caps">Segments — Ranked by Performance</div>
                <div className="text-xs text-text-muted">
                  CTR and impressions not available via API
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="px-5 py-3 text-left label-caps">Segment</th>
                    <th className="px-4 py-3 text-right label-caps">Videos</th>
                    <th className="px-4 py-3 text-right label-caps">Total Views</th>
                    <th className="px-4 py-3 text-right label-caps">Watch Time</th>
                    <th className="px-4 py-3 text-right label-caps">Avg Views / Video</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((row, i) => (
                    <tr
                      key={row.segment}
                      className="border-t border-border-subtle hover:bg-overlay-subtle transition-fast"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-1 h-8 rounded-full flex-shrink-0 ${
                              i === 0 ? "bg-accent" : i === 1 ? "bg-success" : "bg-border"
                            }`}
                          />
                          <span className="text-sm text-text-primary">{row.segment}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-text-secondary">{row.videos}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-text-primary">
                          {row.views.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-text-secondary">
                          {Math.round(row.watchHours).toLocaleString()} hrs
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono text-sm ${
                            i === 0 ? "text-accent" : "text-text-secondary"
                          }`}
                        >
                          {row.videos > 0
                            ? Math.round(row.views / row.videos).toLocaleString()
                            : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-border text-xs text-text-muted">
                Analytics data lags 24–48 hours after publish. Segments with no new uploads in range
                show “—” for average views.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
