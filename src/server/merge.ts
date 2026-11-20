/**
 * A Project's Benchmarks, read off every machine this server holds (admins only, as the host's
 * machine proxy is). Moved from the Web App (lib/benchmark-merge.ts, benchmark-sources.ts), where
 * the page asked each machine itself; the rules are the same.
 *
 * A Benchmark belongs to the Project, and the Project is the same on each machine it is lent to.
 * Its folder, though, is written where the Benchmark was created or evaluated, so one Benchmark's
 * cases and scoreboard can be spread over as many disks as it has run on. So the merge is BY
 * IDENTITY, never by machine: one entry per id, one history of evaluations under it. The machine
 * rides along as attribution — which disk an evaluation was read from, and where a case's files
 * have to be fetched from — and is not a grouping key.
 *
 * - **Order.** A scoreboard's append order IS its evaluation sequence, and it is kept rather than
 *   re-sorted by timestamp. Two scoreboards on two disks share no append order, so a merged history
 *   can only be ordered by time; a Benchmark from a single machine keeps its file's order.
 * - **First source wins the description.** This server is listed first, so its title, runs,
 *   status, version, origin and folder are the ones shown. A source that names no version (its
 *   manifest predates versions, or its server does) has nothing to disagree with, so the next
 *   source that names one supplies the version and the origin together; a copy whose manifest
 *   cannot be read says so, and keeps its own.
 *
 * A machine that does not answer within the deadline, or answers anything but a list, is left out
 * and named in `unreachable`: its scoreboard is missing from the merge, which is what "could not
 * read it" means. This server's own answer never waits on one.
 */
import type {
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkSummary,
  BenchmarksResponse,
  MergedBenchmark,
  MergedCase,
  MergedEvaluation,
} from "../api.js";
import type { MachineApiView } from "./host.js";

/** One server's answer about a Project's Benchmarks, with the machine that gave it. */
export interface BenchmarkSource {
  /** The machine's own id; null for this server. */
  machineId: string | null;
  benchmarks: readonly BenchmarkSummary[];
}

/** Newest last, by the timestamp the scoreboard recorded. */
function byTime(a: MergedEvaluation, b: MergedEvaluation): number {
  return (a.time ?? "").localeCompare(b.time ?? "");
}

/** Folds every source's answer into one list, in the order the sources were asked. */
export function mergeBenchmarks(sources: readonly BenchmarkSource[]): MergedBenchmark[] {
  const byId = new Map<string, MergedBenchmark>();
  for (const source of sources) {
    for (const benchmark of source.benchmarks) {
      const evaluations = benchmark.evaluations.map((evaluation) => ({
        ...evaluation,
        machineId: source.machineId,
      }));
      const existing = byId.get(benchmark.id);
      if (existing === undefined) {
        byId.set(benchmark.id, {
          ...benchmark,
          evaluations,
          agentIds: [...benchmark.agentIds],
          machineIds: [source.machineId],
        });
        continue;
      }
      existing.machineIds.push(source.machineId);
      existing.evaluations.push(...evaluations);
      // A copy that cannot be read is a fact about that copy, not an absence: it keeps its own.
      if (
        existing.version === undefined &&
        existing.manifestError === undefined &&
        benchmark.version !== undefined
      ) {
        existing.version = benchmark.version;
        existing.origin = benchmark.origin;
      }
      // The Agents it has tested are those of every scoreboard, first-seen order kept.
      for (const agentId of benchmark.agentIds) {
        if (!existing.agentIds.includes(agentId)) existing.agentIds.push(agentId);
      }
      // The machines hold overlapping case sets: the largest count is the closest true statement
      // the list alone can make.
      existing.caseCount = Math.max(existing.caseCount, benchmark.caseCount);
    }
  }
  const merged = [...byId.values()];
  for (const benchmark of merged) {
    // Only where two files were joined: a single scoreboard keeps the order it was written in.
    if (benchmark.machineIds.length > 1) benchmark.evaluations.sort(byTime);
  }
  return merged;
}

/** One server's answer about a Benchmark's cases. */
export interface CaseSource {
  machineId: string | null;
  cases: readonly BenchmarkCaseSummary[];
}

/** The union of every copy's cases, first source winning a shared id. */
export function mergeBenchmarkCases(sources: readonly CaseSource[]): MergedCase[] {
  const byId = new Map<string, MergedCase>();
  for (const source of sources) {
    for (const item of source.cases) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, { ...item, machineId: source.machineId });
    }
  }
  return [...byId.values()];
}

/** A machine the merge asks, with its client; a disconnected one has none. */
export interface MachineSource {
  machineId: string;
  api: MachineApiView | null;
}

/** How long one machine's answer is waited for before its copies are left out. */
export const MACHINE_DEADLINE_MS = 8000;

/**
 * Asks every machine for `path` (a GET of its own API), in parallel, each within the deadline:
 * the parsed JSON of each 200 answer that `accept` takes, and the machines that gave none.
 */
export async function askMachines<T>(
  machines: readonly MachineSource[],
  path: string,
  accept: (body: unknown) => T | null,
  deadlineMs = MACHINE_DEADLINE_MS,
): Promise<{ answers: Array<{ machineId: string; answer: T }>; unreachable: string[] }> {
  const asked = await Promise.all(
    machines.map(async ({ machineId, api }) => {
      if (api === null) return { machineId, answer: null };
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
        timer.unref?.();
      });
      try {
        const res = await Promise.race([api.request("GET", path), deadline]);
        if (res === null || res.status !== 200) return { machineId, answer: null };
        return { machineId, answer: accept(JSON.parse(res.text) as unknown) };
      } catch {
        return { machineId, answer: null };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const answers: Array<{ machineId: string; answer: T }> = [];
  const unreachable: string[] = [];
  for (const { machineId, answer } of asked) {
    if (answer === null) unreachable.push(machineId);
    else answers.push({ machineId, answer });
  }
  return { answers, unreachable };
}

/** A machine's list answer, when it is one. */
export function benchmarksAnswer(body: unknown): readonly BenchmarkSummary[] | null {
  const list = (body as Partial<BenchmarksResponse> | null)?.benchmarks;
  return Array.isArray(list) ? (list as BenchmarkSummary[]) : null;
}

/** A machine's case list answer, when it is one. */
export function casesAnswer(body: unknown): readonly BenchmarkCaseSummary[] | null {
  const list = (body as Partial<BenchmarkCasesResponse> | null)?.cases;
  return Array.isArray(list) ? (list as BenchmarkCaseSummary[]) : null;
}
