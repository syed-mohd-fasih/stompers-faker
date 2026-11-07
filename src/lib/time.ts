// Small date helpers. Everything is local time in the UI and ISO (UTC) when
// talking to Health Connect.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-07 14:05" in local time (the format the text inputs use). */
export function formatInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:05" local time, for compact lists. */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:05:09" local time, for the log. */
export function formatClock(d: Date): string {
  return `${formatTime(d)}:${pad(d.getSeconds())}`;
}

/** Parses "YYYY-MM-DD HH:MM" (local). Returns null if malformed. */
export function parseInput(text: string): Date | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject things like 2026-02-31 that JS silently rolls over.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
