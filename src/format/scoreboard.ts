/**
 * A Benchmark's `scoreboard.yaml`: its evaluation records, appended over time by the evaluation
 * Skills (agent-evaluation's scoreboard contract) and read here for display.
 *
 * ```yaml
 * evaluations:
 *   - time: 2026-07-14T09:30:00Z
 *     agent_id: default_agent          # the Agent under test; optional on read
 *     version: 1                       # its Agent State version: a build number or a label
 *     provider: deepseek
 *     model_id: deepseek-v4-pro
 *     thinking_level: medium
 *     summary_title: …                 # optional on read
 *     summary: …                       # optional on read
 *     score: 65                        # model-written average of the case scores, 0..100
 *     cost: 0.0125                     # model-written average of known case costs, or null
 *     duration_ms: 57500               # model-written average of case durations, an integer
 *     cases:
 *       - case: CASE-001-file-summary
 *         score: 60
 *         cost: 0.013
 *         duration_ms: 45000
 *         runs:
 *           - { score: 50, cost: 0.012, duration_ms: 42000, session_id: session-… }
 * ```
 *
 * Case and evaluation averages are authoritative file values: nothing here recomputes an
 * aggregate, migrates an older format or backfills a field. A record out of shape is dropped on
 * its own (a case out of shape drops its whole evaluation), and a file that is not YAML reads as no
 * evaluations, so one bad entry never hides the rest.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { BenchmarkCaseScore, BenchmarkEvaluation, BenchmarkRunScore } from "./types.js";

export type { BenchmarkCaseScore, BenchmarkEvaluation, BenchmarkRunScore };

/** The scoreboard's file name, at the root of a Benchmark's directory. */
export const SCOREBOARD_FILE = "scoreboard.yaml";

/** The scoreboard a new copy starts with: no evaluations. */
export function emptyScoreboard(): string {
  return stringifyYaml({ evaluations: [] });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function scoreOr(v: unknown): number | undefined {
  const value = numberOr(v);
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
}

function nonNegativeOr(v: unknown): number | undefined {
  const value = numberOr(v);
  return value !== undefined && value >= 0 ? value : undefined;
}

function nonNegativeIntegerOr(v: unknown): number | undefined {
  const value = nonNegativeOr(v);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

/** `null` is the one valid unknown-cost representation; undefined means invalid input. */
function nullableCostOr(v: unknown): number | null | undefined {
  if (v === null) return null;
  return nonNegativeOr(v);
}

function stringOr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * The Agent under test on one evaluation. Unlike the runtime fields it never invalidates a
 * record: a scoreboard written before evaluations carried one still displays, unlabelled.
 */
function agentIdOr(v: unknown): string | null {
  const value = typeof v === "string" ? v.trim() : "";
  return value !== "" ? value : null;
}

/** One run; a malformed entry invalidates its containing case. */
function toRun(v: unknown): BenchmarkRunScore | null {
  const r = asRecord(v);
  const score = scoreOr(r.score);
  const cost = nullableCostOr(r.cost);
  const durationMs = nonNegativeIntegerOr(r.duration_ms);
  const sessionId = stringOr(r.session_id);
  if (score === undefined || cost === undefined || durationMs === undefined || !sessionId)
    return null;
  return { score, cost, durationMs, sessionId };
}

/** One case, its stored aggregates trusted as written. */
function toCase(v: unknown): BenchmarkCaseScore | null {
  const cr = asRecord(v);
  const caseId = stringOr(cr.case);
  const score = scoreOr(cr.score);
  const cost = nullableCostOr(cr.cost);
  const durationMs = nonNegativeIntegerOr(cr.duration_ms);
  if (
    !caseId ||
    score === undefined ||
    cost === undefined ||
    durationMs === undefined ||
    "max_score" in cr ||
    !Array.isArray(cr.runs) ||
    cr.runs.length === 0
  ) {
    return null;
  }
  const parsedRuns = cr.runs.map(toRun);
  if (parsedRuns.some((run) => run === null)) return null;
  return { case: caseId, score, cost, durationMs, runs: parsedRuns as BenchmarkRunScore[] };
}

/** One evaluation record, its stored aggregates trusted as written; null when out of shape. */
export function parseEvaluation(v: unknown): BenchmarkEvaluation | null {
  const r = asRecord(v);
  const time = r.time instanceof Date ? r.time.toISOString() : r.time;
  const agentId = agentIdOr(r.agent_id);
  const score = scoreOr(r.score);
  const cost = nullableCostOr(r.cost);
  const durationMs = nonNegativeIntegerOr(r.duration_ms);
  const summary = stringOr(r.summary);
  // Title and body are separate: summary_title is a one-line conclusion, summary the body text.
  const summaryTitle = stringOr(r.summary_title);
  const modelId = stringOr(r.model_id);
  const provider = stringOr(r.provider);
  const thinkingLevel = stringOr(r.thinking_level);
  // The Agent State version is a build number on older scoreboards and a version label (a semver
  // string) on newer ones; both are valid, and the label is shown as written.
  const version = nonNegativeIntegerOr(r.version) ?? stringOr(r.version);
  if (
    typeof time !== "string" ||
    time === "" ||
    score === undefined ||
    cost === undefined ||
    durationMs === undefined ||
    !modelId ||
    !provider ||
    !thinkingLevel ||
    version === undefined ||
    (typeof version === "number" && version < 1) ||
    !Array.isArray(r.cases) ||
    r.cases.length === 0
  ) {
    return null;
  }
  const parsedCases = r.cases.map(toCase);
  if (parsedCases.some((item) => item === null)) return null;
  return {
    time,
    agentId,
    ...(summaryTitle !== undefined ? { summaryTitle } : {}),
    ...(summary !== undefined ? { summary } : {}),
    modelId,
    provider,
    thinkingLevel,
    score,
    version,
    cost,
    durationMs,
    cases: parsedCases as BenchmarkCaseScore[],
  };
}

/**
 * Every well-formed evaluation of a scoreboard's text, in file order (its append order is its
 * evaluation sequence). Text that is not YAML, or holds no `evaluations` list, has none.
 */
export function parseScoreboard(text: string): BenchmarkEvaluation[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return [];
  }
  const evaluations = asRecord(parsed).evaluations;
  if (!Array.isArray(evaluations)) return [];
  return evaluations.map(parseEvaluation).filter((e): e is BenchmarkEvaluation => e !== null);
}
