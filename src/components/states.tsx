/**
 * Shared empty / loading / error primitives.
 *
 * PRD §7 asks for all three on every screen. Skeletons are row-shaped rather
 * than a centred spinner (§8.2) so the page keeps its layout while loading.
 */

/** Page chrome reused by the loading and error states so headers stay put. */
export function ScreenShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-bg-0">
      <div className="px-8 py-6 max-w-[1200px]">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-text-primary">{title}</h1>
          {subtitle && <div className="text-sm mt-0.5 text-text-muted">{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 flex flex-col items-center justify-center py-20 px-6">
      <div className="text-sm font-medium text-text-secondary">{title}</div>
      <div className="text-xs mt-1 max-w-[360px] text-center text-text-muted">{body}</div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-4 py-2 rounded-md text-sm font-medium transition-fast hover:opacity-90 bg-accent text-bg-0"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-danger/20 bg-danger/5 px-5 py-4 flex items-start gap-3">
      <span className="status-dot failed mt-1.5" />
      <div>
        <div className="text-sm font-medium text-danger-text">{title}</div>
        <div className="text-xs mt-1 text-danger-subtle">{detail}</div>
      </div>
    </div>
  );
}

/** Row-shaped skeleton that mimics a dense table or list. */
export function RowSkeleton({ rows = 6, showThumb = false }: { rows?: number; showThumb?: boolean }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5 bg-surface-1">
            {showThumb && <div className="skeleton flex-shrink-0" style={{ width: 64, height: 36 }} />}
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3 rounded" style={{ width: `${72 - i * 6}%` }} />
              <div className="skeleton h-2 rounded" style={{ width: `${38 - i * 3}%` }} />
            </div>
            <div className="skeleton h-3 rounded flex-shrink-0" style={{ width: 64 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div
      className="rounded-lg border border-border bg-surface-1 p-5 space-y-3"
      style={{ minHeight: height }}
    >
      <div className="skeleton h-3 rounded" style={{ width: 120 }} />
      <div className="skeleton rounded" style={{ height: height - 80 }} />
    </div>
  );
}
