/**
 * Colour access outside of Tailwind classes.
 *
 * Three conventions, in order of preference:
 *
 * 1. Static colour  → a Tailwind class (`bg-surface-1`, `text-accent`). Always
 *    prefer this; it is the bulk of the app.
 * 2. Computed colour → `VAR.*` below. Resolves through the same custom
 *    properties, so a future light palette flows through it too.
 * 3. Recharts SVG props → `CHART` literals. Recharts writes `stroke`/`fill` as
 *    SVG *attributes*, and attribute values do not resolve `var()` — these have
 *    to stay literal. Keep them in sync with `index.css` by hand.
 */

/** CSS custom-property references for values chosen at runtime. */
export const VAR = {
  bg0: "var(--color-bg-0)",
  surface1: "var(--color-surface-1)",
  surface2: "var(--color-surface-2)",
  surface3: "var(--color-surface-3)",
  border: "var(--color-border)",
  borderSubtle: "var(--color-border-subtle)",
  borderHover: "var(--color-border-hover)",
  textPrimary: "var(--color-text-primary)",
  textSecondary: "var(--color-text-secondary)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-accent)",
  accentDim: "var(--color-accent-dim)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  dangerText: "var(--color-danger-text)",
  dangerSubtle: "var(--color-danger-subtle)",
} as const;

/** Literal values — SVG attributes only. See note 3 above. */
export const CHART = {
  accent: "#AAFF47",
  grid: "#222225",
  axis: "#6E6E73",
} as const;

/**
 * Calendar and legend colours, assigned by position so a new channel still gets
 * a distinct colour instead of falling through to grey.
 */
const CHANNEL_PALETTE = [
  VAR.accent,
  VAR.warning,
  VAR.success,
  "var(--color-channel-4)",
  "var(--color-channel-5)",
];

export function channelColor(channelId: string, allChannelIds: string[]): string {
  const index = allChannelIds.indexOf(channelId);
  if (index === -1) return VAR.textMuted;
  return CHANNEL_PALETTE[index % CHANNEL_PALETTE.length];
}

export const JOB_TYPE_COLOR: Record<string, string> = {
  slot_generator: VAR.accent,
  analytics_sync: VAR.success,
  reconciliation: VAR.warning,
};

/** Status → colour, for the handful of places that colour text by status. */
export const STATUS_COLOR: Record<string, string> = {
  scheduled: VAR.textSecondary,
  published: VAR.success,
  failed: VAR.danger,
  queued: VAR.warning,
  cancelled: VAR.textMuted,
  draft: VAR.textMuted,
  active: VAR.success,
  paused: VAR.warning,
  success: VAR.success,
  info: VAR.textSecondary,
};
