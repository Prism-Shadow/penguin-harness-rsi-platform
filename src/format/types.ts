/**
 * The evaluation records of a scoreboard as the format reads them (scoreboard.ts), shared with
 * every reader of the format: the workbench's handler answers them as they are, and the page draws
 * them. Types only, camelCase like every other field the handler answers.
 */

/** Raw result of a single run (a scoreboard per-case runs[] entry). */
export interface BenchmarkRunScore {
  score: number;
  /** Run cost, or null when unavailable. */
  cost: number | null;
  durationMs: number;
  /** Id of the Session under test in this run (links to its conversation), or a Harbor trial name. */
  sessionId: string;
}

export interface BenchmarkCaseScore {
  case: string;
  /** Model-written average of this Case's Run scores, on the fixed 0..100 scale. */
  score: number;
  /** Model-written average of known Run costs; null when every Run cost is unknown. */
  cost: number | null;
  /** Model-written average of Run durations, rounded to an integer. */
  durationMs: number;
  runs: BenchmarkRunScore[];
}

export interface BenchmarkEvaluation {
  /** Evaluation timestamp (ISO 8601). */
  time: string;
  /** Agent under test in this round (`agent_id`); null when the record carries none. */
  agentId: string | null;
  /** One-line conclusion. */
  summaryTitle?: string;
  /** How the score was derived and what this round changed. */
  summary?: string;
  /** Model actually used for this round (upstream id, paired with provider). */
  modelId: string;
  provider: string;
  thinkingLevel: string;
  /** Agent State version under test: a build number, or a version label. */
  version: number | string;
  /** Model-written average of Case scores, 0..100. */
  score: number;
  cost: number | null;
  durationMs: number;
  cases: BenchmarkCaseScore[];
}
