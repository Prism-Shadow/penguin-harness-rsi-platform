/**
 * How the page prints numbers and times: the Web App's own conventions (lib/format.ts there), so a
 * score, a cost or a duration reads the same here as on every other page. Words a format needs
 * (how long ago, a month's name) come from the strings table, never from this file.
 */

/** The viewer's display currency (prices are stored in USD). */
export type Currency = "USD" | "CNY";

/** Keep one decimal place but drop a trailing `.0`. */
function trimZero(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** A Benchmark score: integers unchanged, decimals keep up to the stored two places. */
export function formatScore(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** An explicit sign on a delta string: non-negative gets `+`, negative already has `-`. */
export function signedDelta(formatted: string): string {
  return formatted.startsWith("-") ? formatted : `+${formatted}`;
}

/**
 * A cost in the viewer's currency (1 USD ≈ 7 CNY): `—` when unknown; decimals scale with the
 * magnitude (≥100 an integer, ≥1 two places, otherwise four).
 */
export function formatMoney(usd: number | null | undefined, currency: Currency = "USD"): string {
  if (usd == null) return "—";
  const symbol = currency === "CNY" ? "¥" : "$";
  const v = currency === "CNY" ? usd * 7 : usd;
  if (v === 0) return `${symbol}0`;
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `${symbol}${v.toFixed(digits)}`;
}

/** Milliseconds as `820ms`, `2.3s`, `1m3s`. */
export function humanizeDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trimZero(s)}s`;
  // Round the total before splitting it, so 119.7s prints `2m0s`, not `1m60s`.
  const whole = Math.round(s);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/** True while the one-decimal rendering of `v` still fits under `limit`. */
function fitsUnit(v: number, limit = 1024): boolean {
  return Math.abs(Number(v.toFixed(1))) < limit;
}

/** A byte count: `812B`, `3.4KB`, `1.2MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const kb = n / 1024;
  if (fitsUnit(kb)) return `${trimZero(kb)}KB`;
  const mb = kb / 1024;
  if (fitsUnit(mb)) return `${trimZero(mb)}MB`;
  return `${trimZero(mb / 1024)}GB`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** An ISO timestamp as local `yyyy-MM-dd HH:mm`; the input unchanged if it does not parse. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The words a relative time is put in (the strings table's `relative`). */
export interface RelativeWords {
  now: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  days: (n: number) => string;
  monthDay: (month: number, day: number) => string;
}

/**
 * How long ago, for a narrow row: under a minute "now", then minutes, hours and days; a week or
 * older — or a future time (clock skew) — the viewer's own month and day. "" for an unparsable
 * value, so the caller hides the slot.
 */
export function formatRelativeShort(
  iso: string,
  words: RelativeWords,
  now: number = Date.now(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = now - d.getTime();
  const monthDay = () => words.monthDay(d.getMonth() + 1, d.getDate());
  if (diffMs < 0) return monthDay();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return words.now;
  if (min < 60) return words.minutes(min);
  const hours = Math.floor(min / 60);
  if (hours < 24) return words.hours(hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return words.days(days);
  return monthDay();
}
