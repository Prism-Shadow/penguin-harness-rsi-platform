/**
 * Dated versions, `YYYY.MM.DD.N`: a Benchmark's revision (and every Skill's). The legacy spelling
 * `YYYY-MM-DD.N` still reads, as the harness's plugin versions do, so a copy written before the
 * rename compares equal to the same version written after it.
 */

/** The dated version format: a dotted date and a sequence number, e.g. `2026.08.29.1`. */
export const DATE_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

const LEGACY_DATE_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/** Formats a date as local `yyyy-mm-dd` (the local calendar day). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The date and sequence number a version denotes, or null when the string is not one. */
export function parseDateVersion(version: string): { date: string; seq: number } | null {
  if (!DATE_VERSION_PATTERN.test(version) && !LEGACY_DATE_VERSION_PATTERN.test(version)) {
    return null;
  }
  const dot = version.lastIndexOf(".");
  return { date: version.slice(0, dot).replace(/-/g, "."), seq: Number(version.slice(dot + 1)) };
}

/**
 * Orders two dated versions: by date, then by sequence number (numeric, so `.10` follows `.9`).
 * A string that is not a version sorts before every real one.
 */
export function compareDateVersions(a: string, b: string): number {
  const va = parseDateVersion(a);
  const vb = parseDateVersion(b);
  if (!va || !vb) return Number(va !== null) - Number(vb !== null);
  if (va.date !== vb.date) return va.date < vb.date ? -1 : 1;
  return va.seq - vb.seq;
}

/**
 * The version a Benchmark's next revision carries: the day's `.1`, or the next sequence number
 * when `previous` is from that day. A version never goes backwards, so a `previous` dated later
 * than `now` (a clock that ran ahead) also takes its next number. The day is the local calendar
 * day, the one the Agents read as their Environment's date.
 */
export function nextDateVersion(previous?: string, now: Date = new Date()): string {
  const today = formatLocalDate(now).replace(/-/g, ".");
  const last = previous === undefined ? null : parseDateVersion(previous);
  if (last !== null && last.date >= today) return `${last.date}.${last.seq + 1}`;
  return `${today}.1`;
}
