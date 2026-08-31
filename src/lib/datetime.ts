/**
 * Slot times are stored as UTC ISO strings (PRD §9) and converted to the
 * channel's timezone only for display. Every screen goes through these helpers
 * so a slot never shows two different times in two places.
 */

const TZ_ABBR: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
  "Asia/Kuala_Lumpur": "MYT",
  "Asia/Singapore": "SGT",
  "Asia/Manila": "PHT",
  UTC: "UTC",
};

export function tzAbbr(timezone: string): string {
  return TZ_ABBR[timezone] ?? timezone;
}

/**
 * Tanggal hari ini ("YYYY-MM-DD") di zona tertentu.
 *
 * Menggantikan konstanta `TODAY` dari prototipe, yang dipatok ke "2024-12-20".
 * Selama data masih mock, tanggal beku itu tidak terlihat salah; begitu datanya
 * nyata, ia membuat "jadwal hari ini" di Dashboard SELALU kosong — karena tidak
 * ada slot yang pernah jatuh pada tanggal itu.
 */
export function todayInTimezone(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "2024-12-20" in the given timezone. */
export function slotLocalDate(utcIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(utcIso));
}

/** "07:00" in the given timezone. */
export function slotLocalTime(utcIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(utcIso));
}

/** "07:00 WIB" — the form used in timelines and queue lists. */
export function slotLabel(utcIso: string, timezone: string): string {
  return `${slotLocalTime(utcIso, timezone)} ${tzAbbr(timezone)}`;
}

/** Day of month in the channel's timezone, for calendar placement. */
export function slotDayOfMonth(utcIso: string, timezone: string): number {
  return Number(slotLocalDate(utcIso, timezone).slice(8, 10));
}

/** Hour of day (0–23) in the channel's timezone, for the week grid. */
export function slotLocalHour(utcIso: string, timezone: string): number {
  return Number(slotLocalTime(utcIso, timezone).slice(0, 2));
}

function tzOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some engines; normalise it.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Inverse of the display helpers: take a wall-clock date + time in a channel's
 * timezone and produce the UTC ISO string to store. Used when rescheduling.
 */
export function toUtcIso(localDate: string, localTime: string, timezone: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm] = localTime.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes so the offset is measured at the target instant, not at epoch.
  let utc = naive - tzOffsetMinutes(new Date(naive), timezone) * 60_000;
  utc = naive - tzOffsetMinutes(new Date(utc), timezone) * 60_000;
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "10:01" from a UTC ISO string, without timezone conversion. */
export function utcTime(iso: string): string {
  return iso.slice(11, 16);
}

/** "2024-12-20 10:01:03" from a UTC ISO string. */
export function utcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}
