// Small date helpers. Everything is local time in the UI and ISO (UTC) when
// talking to Health Connect.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "14:05" local time. */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:05:09" local time, for the log. */
export function formatClock(d: Date): string {
  return `${formatTime(d)}:${pad(d.getSeconds())}`;
}

/**
 * The format the time inputs use: "Today 14:05", "Yesterday 23:10", or
 * "2026-11-05 14:05" for anything older/newer.
 */
export function formatInput(d: Date, now = new Date()): string {
  const today = startOfToday(now).getTime();
  const t = d.getTime();
  if (t >= today && t < today + DAY) return `Today ${formatTime(d)}`;
  if (t >= today - DAY && t < today) return `Yesterday ${formatTime(d)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(d)}`;
}

/**
 * Parses what formatInput produces, plus a bare "HH:MM" (= today).
 * Case-insensitive. Returns null if malformed.
 */
export function parseInput(text: string, now = new Date()): Date | null {
  const s = text.trim();
  const rel = /^(?:(today|yesterday)\s+)?(\d{1,2}):(\d{2})$/i.exec(s);
  if (rel) {
    const [, day, h, mi] = rel;
    if (Number(h) > 23 || Number(mi) > 59) return null;
    const d = startOfToday(now);
    if (day?.toLowerCase() === 'yesterday') d.setDate(d.getDate() - 1);
    d.setHours(Number(h), Number(mi), 0, 0);
    return d;
  }
  const abs = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(s);
  if (!abs) return null;
  const [, y, mo, d, h, mi] = abs.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject things like 2026-02-31 that JS silently rolls over.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

/** 12345 → "12,345" (no Intl dependency). */
export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
