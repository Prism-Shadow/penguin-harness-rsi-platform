/**
 * What the page (src/ui) reads and sends: the workbench handler's HTTP contract
 * (workbenches/benchmark/lib/api.ts), and the page's own view of it — the Benchmarks of this
 * server and of each machine merged by id (`MergedBenchmark`, src/ui/merge.ts), and the Project
 * as the page reads it from the Web App's own routes (`WorkbenchContext`). Types only, but for the
 * case pager.
 */
import type {
  ApprovalMode,
  AskPromptRequest,
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
  CreatePromptRequest,
  EvaluatePromptRequest,
  ImportPromptRequest,
  ModelRef,
  OptimizePromptRequest,
  TaskRecord,
} from "../workbenches/benchmark/lib/api.js";

export * from "../workbenches/benchmark/lib/api.js";

// ---------------------------------------------------------------------------
// The merged list: this server's answer and each machine's, as the page folds them
// (src/ui/merge.ts)
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

/**
 * A case, and the server whose copy its files are read from (null: this server; another machine's
 * through the host's machine proxy, `/server/<machineId>/api/…`).
 */
export type MergedCase = BenchmarkCaseSummary & { machineId: string | null };

/** The workbench's Benchmarks as the page shows them, merged as the answers land. */
export interface WorkbenchBenchmarksResponse {
  benchmarks: MergedBenchmark[];
  /** This workbench's Benchmark folder, once this server has answered. */
  dir?: string;
  /** Machines that gave no answer; their copies are missing. */
  unreachable?: string[];
  /** Machines asked whose answer has not landed yet; their copies join when it does. */
  pending?: string[];
}

// ---------------------------------------------------------------------------
// The Project as the page reads it from the Web App's routes (src/ui/context-load.ts)
// ---------------------------------------------------------------------------

/** A model the Project has configured. */
export interface WorkbenchModel extends ModelRef {
  /** The display name, when the table gives one. */
  displayName?: string;
}

/** A conversation Agent of the Project (never the system Agent). */
export interface WorkbenchAgent {
  agentId: string;
  name?: string;
  description?: string;
  /** The revision of its avatar picture, for the host's avatar route; absent when it has none. */
  avatarRev?: string;
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
  /** The Agent this workbench is installed on: whose Benchmarks these are. */
  workbenchAgentId: string;
  /** Whether the viewer is a server admin (who reads every machine's copies). */
  isAdmin: boolean;
  agents: WorkbenchAgent[];
  /** The Agent a task goes to unless the form says otherwise: `default_agent`, else the first. */
  defaultAgentId: string | null;
  models: WorkbenchModel[];
  defaultModel: ModelRef | null;
  /** The Optimize tab's methods, the default loop first; [] when the library cannot be read. */
  methods: WorkbenchMethod[];
  /** The plugin that ships each Skill the library knows, for a missing Skill's Install. */
  skillPlugins: Readonly<Record<string, string>>;
  /** Admins only; [] for everyone else. */
  machines: WorkbenchMachine[];
}

// ---------------------------------------------------------------------------
// The tasks the page starts (src/ui/pages/start-task.tsx)
// ---------------------------------------------------------------------------

/** What every start form sends beside its prompt's fields: who carries the task out, and how. */
export interface StartFields {
  /** The Agent that carries the task out, in a new conversation of the person who pressed Start. */
  agentId: string;
  /** Default `allow-all`. */
  approvalMode?: ApprovalMode;
  /** The conversation's model; the Project's default when absent. */
  model?: ModelRef;
}

export type CreateTaskRequest = CreatePromptRequest & StartFields;
export type ImportTaskRequest = ImportPromptRequest & StartFields;
export type EvaluateTaskRequest = EvaluatePromptRequest & StartFields;
export type OptimizeTaskRequest = OptimizePromptRequest & StartFields;
export type AskTaskRequest = AskPromptRequest & StartFields;

/** A start form's request: what the handler builds the prompt from, and the start's own fields. */
export type WorkbenchTaskRequest =
  | CreateTaskRequest
  | ImportTaskRequest
  | EvaluateTaskRequest
  | OptimizeTaskRequest
  | AskTaskRequest;

/**
 * Where a task stands, as the list shows it: `running`, `waiting` (a step waits for someone to
 * approve it), `done`. A conversation the viewer cannot read is not listed at all.
 */
export type TaskState = "running" | "waiting" | "done";

/** One task the page started, with where its conversation stands for the viewer. */
export interface WorkbenchTask extends TaskRecord {
  state: TaskState;
  /** The conversation's title, once it has one. */
  title?: string;
  /** Steps waiting for approval. */
  pendingApprovals: number;
}
