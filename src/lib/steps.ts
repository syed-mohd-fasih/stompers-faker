// Pure step logic: validation, overlap handling and the "spread across today"
// generator. No Health Connect calls in here, so it is easy to reason about.

import { formatNumber, MINUTE, startOfToday } from './time';

/** A time range in epoch milliseconds. `end` is exclusive. */
export interface Range {
  start: number;
  end: number;
}

export interface Chunk extends Range {
  count: number;
}

export const MIN_COUNT = 1;
export const MAX_COUNT = 100_000;
/** Above this pace we warn (it's sprinting territory) but still allow. */
export const MAX_SANE_PACE = 200;

export interface Validation {
  /** Per-field messages, so the UI can show them under the right input. */
  fields: { count?: string; start?: string; end?: string };
  /** Same messages as a flat list (for the log). */
  errors: string[];
  /** Steps per minute when the range is valid, else null. */
  pace: number | null;
  /** True when pace > MAX_SANE_PACE (allowed, but worth a warning). */
  fastPace: boolean;
}

const BAD_TIME = 'Use "Today HH:MM" or YYYY-MM-DD HH:MM.';

export function validateChunk(count: number, start: Date | null, end: Date | null, now = Date.now()): Validation {
  const fields: Validation['fields'] = {};

  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    fields.count = `Whole number from ${MIN_COUNT} to ${formatNumber(MAX_COUNT)}.`;
  }
  if (!start) fields.start = BAD_TIME;
  if (!end) fields.end = BAD_TIME;
  if (start && end) {
    if (start.getTime() >= end.getTime()) fields.start = 'Start must be before end.';
    // One minute of slack so "now" typed into the box doesn't fail by seconds.
    else if (end.getTime() > now + MINUTE) fields.end = 'End is in the future.';
  }

  const errors = Object.values(fields).filter((m): m is string => !!m);
  let pace: number | null = null;
  if (errors.length === 0 && start && end) pace = count / ((end.getTime() - start.getTime()) / MINUTE);
  return { fields, errors, pace, fastPace: pace !== null && pace > MAX_SANE_PACE };
}

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findOverlaps(range: Range, existing: Range[]): Range[] {
  return existing.filter((r) => overlaps(range, r));
}

/**
 * Moves `range` (keeping its duration) so it no longer overlaps `existing`.
 * First tries sliding earlier (so we never end up in the future), then later
 * as long as it still ends by `now`. Returns null if no free slot was found.
 */
export function autoShift(range: Range, existing: Range[], now = Date.now()): Range | null {
  const duration = range.end - range.start;
  const sorted = [...existing].sort((a, b) => a.start - b.start);

  // Slide earlier: keep putting our end at the start of whatever we hit.
  let candidate = { ...range };
  for (let i = 0; i < sorted.length + 1; i++) {
    const hits = findOverlaps(candidate, sorted);
    if (hits.length === 0) return candidate;
    const end = Math.min(...hits.map((h) => h.start));
    candidate = { start: end - duration, end };
  }

  // Slide later: put our start at the end of whatever we hit.
  candidate = { ...range };
  for (let i = 0; i < sorted.length + 1; i++) {
    const hits = findOverlaps(candidate, sorted);
    if (hits.length === 0) return candidate.end <= now ? candidate : null;
    const start = Math.max(...hits.map((h) => h.end));
    candidate = { start, end: start + duration };
  }
  return null;
}

/** Subtracts `busy` ranges from `window`, returning the free gaps in order. */
export function freeRanges(window: Range, busy: Range[]): Range[] {
  const sorted = busy.filter((b) => overlaps(b, window)).sort((a, b) => a.start - b.start);
  const free: Range[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

/**
 * Splits `total` steps into realistic walking chunks between the start of the
 * "active day" and `now`:
 * - each chunk is 10–30 min long, separated by random 5–60 min gaps
 * - chunks never overlap `busy` (this app's existing records) or each other
 * - nothing is in the future
 * - roughly ~100 steps/min, with ±15% random variation per chunk
 */
export function spreadAcrossToday(total: number, busy: Range[], now = Date.now()): Chunk[] {
  const dayStart = startOfToday(new Date(now)).getTime();
  // Start at 07:00 if it's already late enough for that to make sense.
  const wake = dayStart + 7 * 60 * MINUTE;
  const windowStart = now - wake > 60 * MINUTE ? wake : dayStart;

  // 1. Lay out every possible slot in the free time.
  const slots: Range[] = [];
  for (const gap of freeRanges({ start: windowStart, end: now }, busy)) {
    let cursor = gap.start + randInt(0, 5) * MINUTE;
    while (true) {
      const duration = randInt(10, 30) * MINUTE + randInt(0, 59) * 1000;
      if (cursor + duration > gap.end) break;
      slots.push({ start: cursor, end: cursor + duration });
      cursor += duration + randInt(5, 60) * MINUTE + randInt(0, 59) * 1000;
    }
  }
  if (slots.length === 0) return [];

  // 2. Pick a random subset that can hold `total` at a comfortable ~100/min.
  const shuffled = [...slots].sort(() => Math.random() - 0.5);
  const picked: Range[] = [];
  let capacity = 0;
  for (const s of shuffled) {
    picked.push(s);
    capacity += ((s.end - s.start) / MINUTE) * 100;
    if (capacity >= total) break;
  }
  picked.sort((a, b) => a.start - b.start);

  // 3. Share the steps out proportionally to duration, with some jitter.
  const weights = picked.map((s) => (s.end - s.start) * rand(0.85, 1.15));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const chunks: Chunk[] = picked.map((s, i) => ({
    ...s,
    count: Math.floor((total * weights[i]) / weightSum),
  }));
  // Rounding leftovers go to the biggest chunk so the sum is exact.
  const leftover = total - chunks.reduce((a, c) => a + c.count, 0);
  const biggest = chunks.reduce((best, c, i) => (c.count > chunks[best].count ? i : best), 0);
  chunks[biggest].count += leftover;

  return chunks.filter((c) => c.count > 0);
}
