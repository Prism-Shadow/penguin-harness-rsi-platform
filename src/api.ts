/**
 * The workbench's HTTP contract: what its routes answer and take, shared by the server module
 * (src/server) and the iframe app (src/ui). Types only.
 *
 * The data routes under `/api/projects/:projectId/benchmarks` keep the shapes, codes and
 * behaviour the harness's Evaluation Center had (PRFC-0036, "Contributions"), so a machine on an older
 * build answers the same JSON; what is new is the merge of every machine's copies for an admin
 * (`MergedBenchmark`), the page's view of the Project (`WorkbenchContext`) and the Agent tasks the
 * page starts (`WorkbenchTask`).
 *
 * Errors are the host's shape, `{ error: { code, message, details? } }`.
 */

// ---------------------------------------------------------------------------
// Benchmarks as one server holds them
// ---------------------------------------------------------------------------

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

export interface BenchmarksResponse {
  benchmarks: BenchmarkSummary[];
  /** The absolute folder the Project's Benchmarks are in on this server. */
  dir?: string;
}

export type CaseMaterial = "statement" | "rubric";

/** Public Benchmark Case metadata. Rubric and gold content are never included. */
export interface BenchmarkCaseSummary {
  id: string;
  /** First Markdown heading with an optional leading "Case N:" removed; falls back to id. */
  title: string;
}

export interface BenchmarkCasesResponse {
  cases: BenchmarkCaseSummary[];
}

/** POST …/benchmarks (owner only): create a Benchmark by hand. */
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
// The merged list (GET …/benchmarks for an admin with machines)
// ---------------------------------------------------------------------------

/** An evaluation, and the machine whose scoreboard recorded it (null: this server). */
export type MergedEvaluation = BenchmarkEvaluation & { machineId: string | null };

/**
 * One Benchmark as every machine together holds it, merged by id (this server first). An answer
 * from one server only is the same Benchmark with `machineIds: [null]`.
 */
export interface MergedBenchmark extends Omit<BenchmarkSummary, "evaluations"> {
  evaluations: MergedEvaluation[];
  /** The servers holding a copy, in the order they were asked: null is this server. */
  machineIds: (string | null)[];
}

/** A case, and the server whose copy its files are read from (null: this server). */
export type MergedCase = BenchmarkCaseSummary & { machineId: string | null };

/**
 * GET …/benchmarks/:benchmarkId/cases as the workbench page reads it: for an admin, the union of
 * the cases every copy holds, this server's first, the first copy winning a shared id. A case's
 * files are read from the server it is recorded against (the host's machine proxy,
 * `/server/<machineId>/api/…`, for another machine).
 */
export interface WorkbenchCasesResponse {
  cases: MergedCase[];
}

/**
 * GET /api/projects/:projectId/benchmarks as the workbench page reads it. Every field of
 * `BenchmarksResponse` is there, so an older client still reads it; `benchmarks` entries carry
 * the merged fields too.
 */
export interface WorkbenchBenchmarksResponse {
  benchmarks: MergedBenchmark[];
  dir?: string;
  /** Machines that were asked and did not answer in time; their copies are missing. */
  unreachable?: string[];
}

// ---------------------------------------------------------------------------
// The page's view of the Project (GET …/benchmarks/context)
// ---------------------------------------------------------------------------

export interface ModelRef {
  provider: string;
  modelId: string;
}

/** A model the Project has configured. */
export interface WorkbenchModel extends ModelRef {
  /** The display name, when the table or the catalog gives one. */
  displayName?: string;
}

/** A conversation Agent of the Project (never the system Agent). */
export interface WorkbenchAgent {
  agentId: string;
  name?: string;
  description?: string;
  /** The revision of its avatar picture, for the host's avatar route; absent when it has none. */
  avatarRev?: string;
  /** The names of the Skills installed on it. */
  skills: string[];
}

/**
 * One option of the Optimize tab's Method select: the default loop, or an RSI toolkit of the
 * plugin library (a plugin of the `rsi` category whose name ends in `-rsi-toolkit`).
 */
export interface WorkbenchMethod {
  /** The plugin that ships it: the option's value. */
  plugin: string;
  kind: "default" | "paper";
  /** The optimizer Skill the task preselects. */
  skill: string;
  /** The plugin's display name in English and in Chinese, else its name. */
  label: string;
  labelZh: string;
  /** Its short description, else its full one; "" when it carries neither. */
  hint: string;
  hintZh: string;
}

/** A machine whose copies the merged list reads (admins only). */
export interface WorkbenchMachine {
  machineId: string;
  /** The name it goes by on this server. */
  label: string;
}

export interface WorkbenchContext {
  projectId: string;
  /** The viewer's role in the Project: only an owner creates by hand or deletes. */
  role: "owner" | "member";
  /** Whether the viewer is a server admin (who reads every machine's copies). */
  isAdmin: boolean;
  /** The absolute folder this server keeps the Project's Benchmarks in. */
  dir: string;
  agents: WorkbenchAgent[];
  /** The Agent a task goes to unless the form says otherwise: `default_agent`, else the first. */
  defaultAgentId: string | null;
  models: WorkbenchModel[];
  defaultModel: ModelRef | null;
  /** The Optimize tab's methods, the default loop first; [] when the library cannot be read. */
  methods: WorkbenchMethod[];
  /** Admins only; [] for everyone else. */
  machines: WorkbenchMachine[];
}

// ---------------------------------------------------------------------------
// Agent tasks (POST / GET …/benchmarks/tasks)
// ---------------------------------------------------------------------------

/** How a started task's tool calls are approved: the values a new chat offers. */
export type ApprovalMode = "allow-all" | "deny-all" | "read-only" | "always-ask";

export type WorkbenchTaskKind = "create" | "import" | "evaluate" | "optimize" | "ask";

/** What every start form carries. */
export interface TaskRequestBase {
  /** The Agent that carries the task out, in a new conversation of the person who pressed Start. */
  agentId: string;
  /** Default `allow-all`. */
  approvalMode?: ApprovalMode;
  /** The conversation's model; the Project's default when absent. */
  model?: ModelRef;
  /** The language the request is written in: the page's interface language. Default `en`. */
  language?: "en" | "zh";
}

/** Create with AI: the benchmark-design Skill writes and calibrates a Benchmark for `targetAgentId`. */
export interface CreateTaskRequest extends TaskRequestBase {
  kind: "create";
  /** The Test Agent the cases are written for. */
  targetAgentId: string;
  /** What to test, in the person's words. */
  notes: string;
}

/** Import with an Agent: the Agent fetches and copies a Benchmark package. */
export interface ImportTaskRequest extends TaskRequestBase {
  kind: "import";
  /** A repository folder link, a local path or a description. */
  source: string;
}

/** Use → Evaluate. */
export interface EvaluateTaskRequest extends TaskRequestBase {
  kind: "evaluate";
  benchmarkId: string;
  targetAgentId: string;
  /** Runs per case, 1..1000. */
  runs: number;
  /** The model the Test Agent runs on in every test. */
  testedModel: ModelRef;
  notes?: string;
}

/** Use → Optimize, with the default loop (`method` is `default-rsi-toolkit`) or a paper's toolkit. */
export interface OptimizeTaskRequest extends TaskRequestBase {
  kind: "optimize";
  benchmarkId: string;
  targetAgentId: string;
  /** The method's plugin, as `WorkbenchContext.methods` lists it. */
  method: string;
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
export interface AskTaskRequest extends TaskRequestBase {
  kind: "ask";
  benchmarkId: string;
  /** The person's question. */
  question: string;
  /** Exactly one of the two. */
  evaluation?: AskEvaluationFacts;
  case?: AskCaseFacts;
}

export type WorkbenchTaskRequest =
  | CreateTaskRequest
  | ImportTaskRequest
  | EvaluateTaskRequest
  | OptimizeTaskRequest
  | AskTaskRequest;

/** POST …/tasks?preview=1: what Start would send, sending nothing. */
export interface TaskPreviewResponse {
  prompt: string;
  /** The Skills the conversation preselects. */
  skills: string[];
}

/**
 * Where a task stands, as the list shows it: `running`, `waiting` (a step waits for someone to
 * approve it), `done`, `failed`, `gone` (its conversation
 * was deleted, or the viewer cannot open it).
 */
export type TaskState = "running" | "waiting" | "done" | "failed" | "gone";

/** One task the workbench started. */
export interface WorkbenchTask {
  /** The conversation it runs in: `/chat/<sessionId>` opens it. */
  sessionId: string;
  kind: WorkbenchTaskKind;
  /** The Benchmark it is about; absent for create and import. */
  benchmarkId?: string;
  agentId: string;
  /** Who pressed Start. */
  userId: string;
  approvalMode: ApprovalMode;
  /** ISO 8601. */
  createdAt: string;
  state: TaskState;
  /** The conversation's title, once it has one. */
  title?: string;
  /** Steps waiting for approval. */
  pendingApprovals: number;
}

/** POST …/tasks: 201. */
export interface TaskStartResponse {
  task: WorkbenchTask;
}

/** GET …/tasks?benchmarkId=: newest first. */
export interface TasksResponse {
  tasks: WorkbenchTask[];
}
