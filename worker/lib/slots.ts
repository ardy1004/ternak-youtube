/**
 * Slot generator (F4) — fungsi murni, tanpa I/O, agar bisa diuji langsung.
 *
 * Menghitung di timezone channel, mengembalikan UTC ISO. Konversi zona
 * dilakukan lewat Intl, bukan library eksternal, dan lewat dua-lintasan
 * (tebak → ukur pergeseran → koreksi) supaya DST tidak pernah salah.
 */

/** FNV-1a 32-bit. Deterministik dan tanpa dependensi. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Instan UTC untuk jam lokal `hhmm` pada tanggal `dateISO` di `timeZone`.
 *
 * Menebak seolah jam itu UTC, menanyakan Intl bagaimana tebakan itu terbaca di
 * zona target, lalu mengoreksi selisihnya. Ini menangani DST dengan benar tanpa
 * membawa database timezone.
 */
export function localTimeToUtc(dateISO: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const guess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const renderedHour = get("hour") === 24 ? 0 : get("hour");
  const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), renderedHour, get("minute"));

  return new Date(guess - (rendered - guess));
}

/** "YYYY-MM-DD" hari ini di zona tertentu. */
export function todayInTimezone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO hari dalam seminggu (1 = Senin … 7 = Minggu) untuk tanggal di zona tertentu. */
export function isoDayOfWeek(dateISO: string, timeZone: string): number {
  const noon = localTimeToUtc(dateISO, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(noon);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[name] ?? 1;
}

export interface SlotConfig {
  count: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  timezone: string;
  activeDays: string[];
  /** Mengunci jitter ke (channel, tanggal) — hasil yang sama untuk input sama. */
  seed: string;
}

/**
 * Menghasilkan waktu slot UTC untuk satu hari.
 *
 * Jitter-nya berbasis hash dari (channel, tanggal), BUKAN penambahan tetap per
 * hari. Pola linear terukur lebih buruk terhadap tujuannya sendiri: dengan
 * penambahan tetap, jadwal merayap satu menit per hari dalam garis lurus —
 * tanda tangan yang justru LEBIH mekanis daripada memposting di menit tetap —
 * dan setiap channel serempak kembali ke jam dasarnya pada hari yang sama.
 *
 * Dikunci ke tanggal, bukan penghitung: build yang terlewat tidak menggeser
 * apa pun.
 */
export function generateSlots(dateISO: string, config: SlotConfig): string[] {
  if (config.count <= 0) return [];

  // Hari tidak aktif tidak menghasilkan slot sama sekali.
  if (config.activeDays.length > 0) {
    const dow = String(isoDayOfWeek(dateISO, config.timezone));
    if (!config.activeDays.includes(dow)) return [];
  }

  const startMin = toMinutes(config.windowStart);
  const endMin = toMinutes(config.windowEnd);
  if (endMin <= startMin) return [];

  const slots: string[] = [];
  const span = endMin - startMin;

  // Jarak antar slot: hormati intervalMin, tapi jangan sampai slot terakhir
  // melewati windowEnd — jendela yang menang, bukan interval.
  const maxInterval = config.count > 1 ? Math.floor(span / (config.count - 1)) : span;
  const interval = Math.min(config.intervalMin, Math.max(1, maxInterval));

  // Sisa ruang setelah semua slot ditempatkan = ruang gerak jitter.
  const used = interval * (config.count - 1);
  const drift = Math.max(0, span - used);
  const offset = drift > 0 ? hashSeed(config.seed) % drift : 0;

  for (let i = 0; i < config.count; i++) {
    const minute = startMin + offset + interval * i;
    if (minute > endMin) break;
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    slots.push(localTimeToUtc(dateISO, `${hh}:${mm}`, config.timezone).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }

  return slots;
}

/**
 * Berapa slot yang boleh dipakai channel ini hari ini (warm-up, §7.3 grup 8).
 *
 * Channel baru yang langsung memposting beberapa kali sehari adalah sinyal
 * spam, dan terminasi di sini berarti kehilangan channel sungguhan. Karena itu
 * ramp dikunci ke tanggal mulai channel ITU SENDIRI — channel yang ditambahkan
 * bulan depan menghangat dari nol, tidak mewarisi kadensi channel lama.
 */
export function activeSlotCount(
  channel: {
    videosPerDay: number;
    maxUploadsPerDay: number;
    warmupEnabled: boolean;
    warmupDays: number;
    warmupStartPerDay: number;
    warmupStartedAt: string | null;
  },
  now = new Date(),
): number {
  const ceiling = Math.min(channel.videosPerDay, channel.maxUploadsPerDay);
  if (!channel.warmupEnabled || !channel.warmupStartedAt) return ceiling;

  const started = new Date(channel.warmupStartedAt);
  if (Number.isNaN(started.getTime())) return ceiling;

  const daysLive = Math.floor((now.getTime() - started.getTime()) / 86_400_000);
  const phaseLength = Math.max(1, channel.warmupDays);
  // Dijepit minimal 1: warmupStartedAt di masa depan (jadwal peluncuran, atau
  // jam sistem meleset) tetap memposting sekali sehari, bukan diam total.
  const phase = Math.max(1, Math.floor(daysLive / phaseLength) + 1);
  const allowed = channel.warmupStartPerDay + (phase - 1);

  return Math.max(1, Math.min(allowed, ceiling));
}
