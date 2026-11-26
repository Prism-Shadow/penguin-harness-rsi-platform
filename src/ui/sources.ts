/**
 * The page's reads fanned out over this server and the machines it holds, merged as each answers
 * (the Web App's benchmark-sources.ts; the rules are ../merge.ts). This server's rows show the
 * moment it answers and each machine's join when its own answer lands, so a machine that holds its
 * connection but answers nothing keeps back its own copies and nothing else. A machine that gives
 * no answer is named, not an error; only when no source answered is there an error to report.
 *
 * Only an admin's context names machines (the machine reads are an admin's), so anyone else reads
 * this server alone. A read asked again keeps what is on screen until the new answers land, and an
 * answer to an older read is dropped.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  BenchmarkCasesResponse,
  BenchmarkSummary,
  MergedCase,
  WorkbenchBenchmarksResponse,
} from "../api";
import { mergeBenchmarkCases, mergeBenchmarks } from "../merge";
import type { ProjectApi } from "./api";

/** Where the reads stand: each source's last answer, and which are still out or failed. */
interface Answers<T> {
  /** What the answers are about; answers about anything else are never shown. */
  scope: string;
  /** Source (null: this server) → its last answer. */
  answers: ReadonlyMap<string | null, T>;
  /** Sources asked whose answer has not landed. */
  out: ReadonlySet<string | null>;
  /** Source → why its last ask failed, while it has no newer answer. */
  failures: ReadonlyMap<string | null, unknown>;
}

const nothing = <T>(scope: string): Answers<T> => ({
  scope,
  answers: new Map(),
  out: new Set(),
  failures: new Map(),
});

/**
 * Asks every source of `sources` with `ask` whenever `key` changes, keeping each source's last
 * answer meanwhile, while `scope` (what is asked about) stays the same; a source that leaves the
 * list takes its answer with it, and a new scope starts with none.
 */
function useFanOut<T>(
  sources: readonly (string | null)[],
  ask: (source: string | null) => Promise<T>,
  scope: string,
  key: string,
): Answers<T> {
  const [state, setState] = useState<Answers<T>>(() => nothing(scope));
  useEffect(() => {
    let live = true;
    const wanted = new Set(sources);
    setState((prev) => {
      const kept = prev.scope === scope ? prev : nothing<T>(scope);
      return {
        scope,
        answers: new Map([...kept.answers].filter(([source]) => wanted.has(source))),
        out: new Set(sources),
        failures: new Map([...kept.failures].filter(([source]) => wanted.has(source))),
      };
    });
    for (const source of sources) {
      ask(source).then(
        (answer) => {
          if (!live) return;
          setState((prev) => {
            const out = new Set(prev.out);
            out.delete(source);
            const failures = new Map(prev.failures);
            failures.delete(source);
            return { ...prev, answers: new Map(prev.answers).set(source, answer), out, failures };
          });
        },
        (error: unknown) => {
          if (!live) return;
          setState((prev) => {
            const out = new Set(prev.out);
            out.delete(source);
            return { ...prev, out, failures: new Map(prev.failures).set(source, error) };
          });
        },
      );
    }
    return () => {
      live = false;
    };
    // `scope` and `key` name `sources` and what `ask` reads; a new function each render asks
    // nothing again.
  }, [scope, key]);
  return state.scope === scope ? state : nothing(scope);
}

export interface BenchmarksView {
  /** Every answer in hand, merged (this server's first); null until there is one to show. */
  listed: WorkbenchBenchmarksResponse | null;
  /** Why the Project's Benchmarks could not be read, once no source answered and none is out. */
  error: unknown;
}

/** The Project's Benchmarks on this server and `machineIds`, asked again on `reloadKey`. */
export function useBenchmarkSources(
  api: ProjectApi,
  machineIds: readonly string[],
  reloadKey: string,
): BenchmarksView {
  const sources = useMemo(() => [null, ...machineIds], [machineIds.join(",")]);
  const { answers, out, failures } = useFanOut<{ benchmarks: BenchmarkSummary[]; dir?: string }>(
    sources,
    (machineId) => api.listBenchmarks(machineId),
    "",
    `${sources.join(",")}|${reloadKey}`,
  );
  return useMemo(() => {
    const answered = sources.flatMap((machineId) => {
      const answer = answers.get(machineId);
      return answer === undefined ? [] : [{ machineId, benchmarks: answer.benchmarks }];
    });
    const here = answers.get(null);
    const pending = machineIds.filter((machineId) => out.has(machineId));
    // This server's rows lead: nothing shows before it answers, unless it failed and a machine
    // has answered since.
    if (here === undefined && (out.has(null) || (answered.length === 0 && pending.length > 0))) {
      return { listed: null, error: null };
    }
    if (answered.length === 0) return { listed: null, error: failures.get(null) ?? null };
    const unreachable = machineIds.filter((machineId) => failures.has(machineId));
    return {
      listed: {
        benchmarks: mergeBenchmarks(answered),
        ...(here?.dir !== undefined ? { dir: here.dir } : {}),
        ...(unreachable.length > 0 ? { unreachable } : {}),
        ...(pending.length > 0 ? { pending } : {}),
      },
      error: null,
    };
  }, [sources, answers, out, failures, machineIds]);
}

export interface CasesView {
  /** The cases every copy that answered holds, merged; null until one has answered. */
  cases: MergedCase[] | null;
  total?: number;
  /** Why the first copy could not be read, once every copy failed. */
  error: unknown;
}

/**
 * One Benchmark's cases from the servers that hold a copy of it — `machineIds`, null for this
 * server — merged as each answers, the first copy winning a shared id.
 */
export function useBenchmarkCases(
  api: ProjectApi,
  benchmarkId: string,
  machineIds: readonly (string | null)[],
  localPage?: number,
): CasesView {
  const key = JSON.stringify(machineIds);
  const sources = useMemo(() => [...machineIds], [key]);
  const { answers, out, failures } = useFanOut<BenchmarkCasesResponse>(
    sources,
    (machineId) =>
      localPage === undefined
        ? api.cases(benchmarkId, machineId)
        : api.casePage(benchmarkId, localPage),
    localPage === undefined ? benchmarkId : `${benchmarkId}/${localPage}`,
    key,
  );
  return useMemo(() => {
    const answered = sources.flatMap((machineId) => {
      const answer = answers.get(machineId);
      return answer === undefined ? [] : [{ machineId, cases: answer.cases }];
    });
    if (answered.length > 0) {
      return { cases: mergeBenchmarkCases(answered), total: answers.get(null)?.total, error: null };
    }
    if (out.size === 0 && sources.length > 0) {
      return { cases: null, error: failures.get(sources[0]!) ?? null };
    }
    return { cases: null, error: null };
  }, [sources, answers, out, failures]);
}
