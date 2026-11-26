/**
 * The id the manual form proposes for a Benchmark, made here from its title: no model is asked.
 * The title's ASCII letters and digits in lower case, every other run of characters one `-`
 * (kebab-case), accents dropped first so `Café` reads `cafe`; `benchmark-<yyyymmdd>` (the local
 * day) for a title with no ASCII letter. An id the list already holds takes the first free
 * numeric suffix (`-2`, `-3`, …), compared without letter case, as a disk that ignores it would.
 * The handler still refuses a taken id (409), which the form then says.
 */

/** The longest id the create route takes. */
const MAX_ID = 100;

/** `yyyymmdd`: the local calendar day of `date`. */
function compactDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function proposeBenchmarkId(
  title: string,
  taken: readonly string[],
  now: Date = new Date(),
): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Room for a suffix, without a trailing "-" a cut could leave.
  const base = (/[a-z]/.test(slug) ? slug : `benchmark-${compactDate(now)}`)
    .slice(0, MAX_ID - 6)
    .replace(/-+$/, "");
  const used = new Set(taken.map((id) => id.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
