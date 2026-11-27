/**
 * A workbench's Benchmarks, as this server and the machines it holds answer for them, folded into
 * one list. Moved from the Web App (lib/benchmark-merge.ts); the page merges the answers as each
 * lands (sources.ts), so the rules are the same and a quiet machine holds back nothing but
 * its own copies.
 *
 * A Benchmark belongs to an Agent's workbench, and the Agent is the same on each machine the
 * Project is lent to.
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
 */
import type {
  BenchmarkCaseSummary,
  BenchmarkSummary,
  MergedBenchmark,
  MergedCase,
  MergedEvaluation,
} from "../api";

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
