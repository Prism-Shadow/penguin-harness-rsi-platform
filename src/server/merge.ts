/**
 * One machine's copies of a Project's Benchmarks, read for an admin through the host's machine
 * client (as the host's machine proxy is, admins only). The page asks for each machine on its own
 * (`GET …/benchmarks?machine=<id>`, `GET …/:benchmarkId/cases?machine=<id>`) and merges the
 * answers as they land (../merge.ts, ../ui/sources.ts), so this server's rows never wait on a
 * machine, nor one machine on another.
 *
 * A machine is asked for its own list with `?local=1`, which a server of an older version of this
 * plugin needed to keep from asking its own machines in turn; a harness that still serves the
 * Evaluation Center itself ignores it and answers its local list all the same.
 */
import type { BenchmarkCasesResponse, BenchmarkSummary, BenchmarksResponse } from "../api.js";
import { casePage } from "../api.js";
import type { MachineApiView } from "./host.js";

/** How long one machine's answer is waited for before it counts as no answer. */
export const MACHINE_DEADLINE_MS = 8000;

/**
 * The parsed JSON of a machine's 200 answer to `GET path`, when `accept` takes it; null when the
 * machine is not connected, answers anything else, or has not answered within the deadline.
 */
export async function askMachine<T>(
  api: MachineApiView | null,
  path: string,
  accept: (body: unknown) => T | null,
  deadlineMs = MACHINE_DEADLINE_MS,
): Promise<T | null> {
  if (api === null) return null;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
    timer.unref?.();
  });
  try {
    const res = await Promise.race([api.request("GET", path), deadline]);
    if (res === null || res.status !== 200) return null;
    return accept(JSON.parse(res.text) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A machine's list answer, when it is one. */
export function benchmarksAnswer(body: unknown): readonly BenchmarkSummary[] | null {
  const list = (body as Partial<BenchmarksResponse> | null)?.benchmarks;
  return Array.isArray(list) ? (list as BenchmarkSummary[]) : null;
}

/** Older machines ignore case queries and return the full list. Apply the selection at the hub. */
export function casesAnswer(
  body: unknown,
  page?: number,
  wanted?: ReadonlySet<string>,
): BenchmarkCasesResponse | null {
  const answer = body as Partial<BenchmarkCasesResponse> | null;
  if (!Array.isArray(answer?.cases)) return null;
  if (page !== undefined) {
    return typeof answer.total === "number"
      ? { cases: answer.cases, total: answer.total }
      : { cases: casePage(answer.cases, page), total: answer.cases.length };
  }
  return { cases: wanted?.size ? answer.cases.filter((c) => wanted.has(c.id)) : answer.cases };
}

export function caseIdsAnswer(body: unknown): string[] | null {
  const ids = (body as { ids?: string[] } | null)?.ids;
  return Array.isArray(ids) ? ids : (casesAnswer(body)?.cases.map((c) => c.id) ?? null);
}
