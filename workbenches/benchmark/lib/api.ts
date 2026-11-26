/**
 * The handler's HTTP contract under the workbench's API mount
 * (`/api/projects/:projectId/agents/:agentId/workbenches/benchmark/api/…`): what its routes answer
 * and take. The page (`src/ui` in the repository) reads the same types. Types only, but for the
 * case pager both sides count with.
 *
 * The Benchmark routes keep the requests, answers and error codes of the data routes they replace
 * (`/api/projects/:projectId/benchmarks…`, PRFC-0036), so a page that reads a machine still on
 * those routes reads the same JSON. Errors are `{ error: { code, message, details? } }`.
 */
import type { BenchmarkEvaluation } from "./format/types.js";

export type { BenchmarkCaseScore, BenchmarkEvaluation, BenchmarkRunScore } from "./format/types.js";

/** `draft` while being built, `failed` when calibration never finished, `published` otherwise. */
export type BenchmarkStatus = "draft" | "published" | "failed";

/** Where a copy came from. */
export type BenchmarkOriginKind = "builtin" | "manual" | "agent" | "git" | "zip";

/** Why a Benchmark's manifest cannot be read (the format's BenchmarkManifestError). */
export interface BenchmarkManifestProblem {
  code: string;
  message: string;
}

/** The `[origin]` table of a Benchmark's benchmark_config.toml. */
export interface BenchmarkOrigin {
  kind: BenchmarkOriginKind;
  /** git: the folder link as the user gave it. Always an http(s) URL. */
  url?: string;
  /** git: the 40-hex commit the import resolved the link to. */
  ref?: string;
  /** git: the folder inside the repository. */
  path?: string;
  /** git / zip: when this copy was written (ISO 8601; `imported_at` in the file). */
  importedAt?: string;
}

export interface BenchmarkSummary {
  /** Directory name is the identifier. */
  id: string;
  /**
   * The Benchmark's absolute folder on the server that answered (`BENCHMARK_DIR`). Absent from a
   * server that predates it.
   */
  dir?: string;
  /** Title from benchmark_config.toml; the directory name when it gives none or cannot be read. */
  title: string;
  /** The Chinese title (`title_zh`), when the manifest gives one. */
  titleZh?: string;
  description?: string;
  /** The description in Chinese (`description_zh`), when the manifest gives one. */
  descriptionZh?: string;
  /** Runs per case; absent reads as 1. */
  runs?: number;
  status: BenchmarkStatus;
  /** The manifest's version; absent when it has none or cannot be read. */
  version?: string;
  /** Where this copy came from; absent when unknown. */
  origin?: BenchmarkOrigin;
  /** Set when the manifest cannot be read; such a Benchmark lists as `failed`. */
  manifestError?: BenchmarkManifestProblem;
  /** Number of `CASE-*` folders. */
  caseCount: number;
  /** The scoreboard's evaluations, in file order. */
  evaluations: BenchmarkEvaluation[];
  /** The distinct non-null `agentId`s of `evaluations`, first-seen order. */
  agentIds: string[];
}

/** GET …/benchmarks. */
export interface BenchmarksResponse {
  benchmarks: BenchmarkSummary[];
  /** The absolute folder the Benchmarks are in: this workbench's data folder. */
  dir?: string;
}

export type CaseMaterial = "statement" | "rubric";

/** Public Benchmark Case metadata. Rubric and gold content are never included. */
export interface BenchmarkCaseSummary {
  id: string;
  /** First Markdown heading with an optional leading "Case N:" removed; falls back to id. */
  title: string;
}

/** GET …/benchmarks/:benchmarkId/cases[?page=]. */
export interface BenchmarkCasesResponse {
  cases: BenchmarkCaseSummary[];
  /** Number of cases in the copy, included on paged reads. */
  total?: number;
}

export const CASES_PER_PAGE = 5;

/** The cases on a one-based page, in their existing order. */
export function casePage<T>(items: T[], page: number): T[] {
  return items.slice((page - 1) * CASES_PER_PAGE, page * CASES_PER_PAGE);
}

/** POST …/benchmarks (any member): create a Benchmark by hand. */
export interface BenchmarkCreateRequest {
  id: string;
  title: string;
  description?: string;
  /** Runs per case (integer 1..1000; default 1). */
  runs?: number;
  cases: BenchmarkCreateCase[];
}

export interface BenchmarkCreateCase {
  /** `CASE-` followed by letters, digits, `_` and `-`. */
  id: string;
  title: string;
  statement: string;
  rubric: string;
}

export interface BenchmarkCreateResponse {
  benchmark: BenchmarkSummary;
}

/** POST …/benchmarks/archive (any member): import a package from a zip. */
export interface BenchmarkArchiveImportRequest {
  /** The zip, base64-encoded. */
  dataBase64: string;
  /** Replace the Benchmark of the same id whole; 409 `benchmark_busy` while it is being evaluated. */
  overwrite?: boolean;
  /** The repository folder the package was fetched from, pinned to one commit. */
  origin?: BenchmarkArchiveGitOrigin;
}

export interface BenchmarkArchiveGitOrigin {
  kind: "git";
  url: string;
  /** The 40-character commit the link was resolved to. */
  ref: string;
  path: string;
}

export interface BenchmarkArchiveImportResponse {
  benchmark: BenchmarkSummary;
}

/** One entry of a case's file listing (the host's Workspace listing shape). */
export interface CaseFileEntry {
  name: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: string;
}

/** GET …/cases/:caseId/files and …/rubric/files. */
export interface CaseFilesResponse {
  /** Requested relative path ("" = the material's root). */
  path: string;
  entries: CaseFileEntry[];
}

// ---------------------------------------------------------------------------
// The request a task sends (GET or POST …/prompt) and the tasks the page started (…/tasks)
// ---------------------------------------------------------------------------

/** How a started task's tool calls are approved: the values a new chat offers. */
export type ApprovalMode = "allow-all" | "deny-all" | "read-only" | "always-ask";

export type WorkbenchTaskKind = "create" | "import" | "evaluate" | "optimize" | "ask";

export interface ModelRef {
  provider: string;
  modelId: string;
}

/** What every prompt request carries. */
export interface PromptRequestBase {
  /** The language the request is written in: the page's interface language. Default `en`. */
  language?: "en" | "zh";
}

/** Create with AI: the benchmark-design Skill writes and calibrates a Benchmark for `targetAgentId`. */
export interface CreatePromptRequest extends PromptRequestBase {
  kind: "create";
  /** The Test Agent the cases are written for. */
  targetAgentId: string;
  /** What to test, in the person's words. */
  notes: string;
}

/** Import with an Agent: the Agent fetches and copies a Benchmark package. */
export interface ImportPromptRequest extends PromptRequestBase {
  kind: "import";
  /** A repository folder link, a local path or a description. */
  source: string;
}

/** Use → Evaluate. */
export interface EvaluatePromptRequest extends PromptRequestBase {
  kind: "evaluate";
  benchmarkId: string;
  targetAgentId: string;
  /** Runs per case, 1..1000. */
  runs: number;
  /** The model the Test Agent runs on in every test. */
  testedModel: ModelRef;
  notes?: string;
}

/**
 * Use → Optimize, with the default loop (`method` is `default-rsi-toolkit`) or a paper's toolkit,
 * whose optimizer Skill is `skill`.
 */
export interface OptimizePromptRequest extends PromptRequestBase {
  kind: "optimize";
  benchmarkId: string;
  targetAgentId: string;
  /** The method's plugin. */
  method: string;
  /** A paper's toolkit: the Skill that runs its loop. Ignored for the default loop. */
  skill?: string;
  testedModel: ModelRef;
  /** The default loop: runs per case, round limit (1..100) and target score (1..100). */
  runs?: number;
  roundLimit?: number;
  targetScore?: number;
  /** A paper's toolkit: complete passes over the test set per reported State (1..100). */
  testRepetitions?: number;
  /** Focus. */
  notes?: string;
}

/**
 * One case of the evaluation the person asks about, formatted as the dialog prints it (the
 * currency and duration units are the reader's own).
 */
export interface AskEvaluationCaseFacts {
  id: string;
  score: string;
  cost: string;
  duration: string;
  sessionIds: string[];
}

/** The evaluation an Ask AI question is about, its numbers formatted as on screen. */
export interface AskEvaluationFacts {
  time: string;
  label: string;
  version: number | string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  score: string;
  cost: string;
  duration: string;
  summaryTitle: string;
  summary: string;
  cases: AskEvaluationCaseFacts[];
}

/** The case an Ask AI question is about. */
export interface AskCaseFacts {
  caseId: string;
  /** This case's results in the newest evaluation; null when there is none. */
  latest: { time: string; score: string; runs: { score: string; sessionId: string }[] } | null;
}

/** Ask AI about one evaluation or one case: read and explain, change nothing. */
export interface AskPromptRequest extends PromptRequestBase {
  kind: "ask";
  benchmarkId: string;
  /** The person's question. */
  question: string;
  /** Exactly one of the two. */
  evaluation?: AskEvaluationFacts;
  case?: AskCaseFacts;
}

export type PromptRequest =
  | CreatePromptRequest
  | ImportPromptRequest
  | EvaluatePromptRequest
  | OptimizePromptRequest
  | AskPromptRequest;

/** What Start sends: the request, the Skills it preselects, and those it cannot run without. */
export interface PromptResponse {
  prompt: string;
  /** Preselected with a `[use_skills]` block, each only when the Agent has it. */
  skills: string[];
  /** Of `skills`, the ones the task cannot do without: Start offers to install a missing one. */
  required: string[];
}

/** POST …/tasks: what the page records once it has started a task's conversation. */
export interface TaskRecordRequest {
  /** The conversation it runs in: `/chat/<sessionId>` opens it. */
  sessionId: string;
  kind: WorkbenchTaskKind;
  /** The Benchmark it is about; absent for create and import. */
  benchmarkId?: string;
  /** The Agent that carries it out. */
  agentId: string;
  approvalMode: ApprovalMode;
}

/** One task the page started from this workbench, as the handler keeps it. */
export interface TaskRecord extends TaskRecordRequest {
  /** When it was recorded (ISO 8601). */
  createdAt: string;
}

/** POST …/tasks: 201. */
export interface TaskRecordResponse {
  task: TaskRecord;
}

/** GET …/tasks[?benchmarkId=]: newest first. */
export interface TasksResponse {
  tasks: TaskRecord[];
}
