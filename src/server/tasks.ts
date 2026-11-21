/**
 * The Agent tasks the workbench starts (PRFC-0036, "Agent tasks started by the server"): a start form's
 * request, checked and turned into a message (prompts.ts), started through the host's AgentTasks
 * as an ordinary conversation of the person who pressed Start — in their sidebar, with the
 * approval badge and the completion notification — and recorded in the app's state folder, so the
 * page can list what it started and where each stands.
 *
 * - Who: any member of the Project, signed in as a person (the route refuses the local API token:
 *   an Agent's shell must not start tasks in someone's name).
 * - What it needs: the chosen Agent must be a conversation Agent of the Project and carry the
 *   Skills the task cannot do without; a missing one is 409 `skill_missing`, naming the plugin
 *   that ships it, and nothing starts.
 * - Approval: the form's choice, `allow-all` unless it says otherwise, as a scheduled task's.
 * - Records: one JSON line per task in `<stateDir>/tasks.jsonl` (session id, kind, Benchmark,
 *   Agent, who, approval mode, time). A task still under way is asked of the host each time it is
 *   listed; once the host has said it is done, failed, or not there for the viewer, a second line
 *   records that answer for that viewer and the host is not asked again, so a list costs one host
 *   read per live task, not one per task. A conversation the viewer cannot open is not listed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalMode,
  AskCaseFacts,
  AskEvaluationFacts,
  ModelRef,
  TaskState,
  WorkbenchMethod,
  WorkbenchTask,
  WorkbenchTaskKind,
} from "../api.js";
import { isValidId } from "../format/ids.js";
import { WorkbenchError, badRequest } from "./errors.js";
import type { AgentTaskStatus } from "./host.js";
import { DEFAULT_TOOLKIT_PLUGIN, OPTIMIZATION_SKILL } from "./methods.js";
import type { PromptLanguage, TaskSpec } from "./prompts.js";
import { optionalInteger, optionalString, requireString } from "./validate.js";

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];
const KINDS: readonly WorkbenchTaskKind[] = ["create", "import", "evaluate", "optimize", "ask"];

/** A person's own text in a request: generous, but a form is not a corpus. */
const MAX_NOTES = 20_000;
const MAX_SHORT = 200;
const MAX_SOURCE = 4096;
const MAX_FACT_CASES = 200;
const MAX_FACT_RUNS = 1000;

/** How many records a list reads, newest first. */
export const TASK_LIST_LIMIT = 50;

/** The default toolkit's method when the library cannot be read: the loop the tab always had. */
const DEFAULT_METHOD: WorkbenchMethod = {
  plugin: DEFAULT_TOOLKIT_PLUGIN,
  kind: "default",
  skill: OPTIMIZATION_SKILL,
  label: "Default RSI Toolkit",
  labelZh: "Default RSI Toolkit",
  hint: "",
  hintZh: "",
};

/** What every request carries beside its kind's fields. */
export interface TaskCommon {
  agentId: string;
  approvalMode: ApprovalMode;
  model?: ModelRef;
  language: PromptLanguage;
}

/** A request as the body reads, before the server looked anything up. */
export type ParsedTask = TaskCommon &
  (
    | { kind: "create"; targetAgentId: string; notes: string }
    | { kind: "import"; source: string }
    | {
        kind: "evaluate";
        benchmarkId: string;
        targetAgentId: string;
        runs: number;
        testedModel: ModelRef;
        notes: string;
      }
    | {
        kind: "optimize";
        benchmarkId: string;
        targetAgentId: string;
        method: string;
        testedModel: ModelRef;
        runs?: number;
        roundLimit?: number;
        targetScore?: number;
        testRepetitions?: number;
        notes: string;
      }
    | {
        kind: "ask";
        benchmarkId: string;
        question: string;
        evaluation?: AskEvaluationFacts;
        case?: AskCaseFacts;
      }
  );

function asObject(v: unknown, label: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw badRequest(`${label} must be an object.`);
  }
  return v as Record<string, unknown>;
}

function requireId(obj: Record<string, unknown>, key: string): string {
  const v = requireString(obj, key, { minLen: 1, maxLen: 100 });
  if (!isValidId(v)) throw badRequest(`${key} may only contain letters, digits, "_" and "-".`);
  return v;
}

function modelOf(raw: unknown, label: string): ModelRef {
  const m = asObject(raw, label);
  return {
    provider: requireString(m, "provider", {
      minLen: 1,
      maxLen: MAX_SHORT,
      label: `${label}.provider`,
    }),
    modelId: requireString(m, "modelId", {
      minLen: 1,
      maxLen: MAX_SHORT,
      label: `${label}.modelId`,
    }),
  };
}

function shortString(obj: Record<string, unknown>, key: string, label: string): string {
  return requireString(obj, key, { maxLen: MAX_NOTES, label });
}

function stringList(raw: unknown, label: string, max: number): string[] {
  if (!Array.isArray(raw)) throw badRequest(`${label} must be an array of strings.`);
  if (raw.length > max) throw badRequest(`${label} must hold at most ${max} entries.`);
  return raw.map((item, i) => {
    if (typeof item !== "string" || item.length > MAX_SHORT) {
      throw badRequest(`${label}[${i}] must be a string of at most ${MAX_SHORT} characters.`);
    }
    return item;
  });
}

function evaluationFacts(raw: unknown): AskEvaluationFacts {
  const e = asObject(raw, "evaluation");
  const version = e.version;
  if (typeof version !== "number" && typeof version !== "string") {
    throw badRequest("evaluation.version must be a number or a string.");
  }
  if (!Array.isArray(e.cases) || e.cases.length > MAX_FACT_CASES) {
    throw badRequest(`evaluation.cases must be an array of at most ${MAX_FACT_CASES} cases.`);
  }
  return {
    time: shortString(e, "time", "evaluation.time"),
    label: shortString(e, "label", "evaluation.label"),
    version,
    provider: shortString(e, "provider", "evaluation.provider"),
    modelId: shortString(e, "modelId", "evaluation.modelId"),
    thinkingLevel: shortString(e, "thinkingLevel", "evaluation.thinkingLevel"),
    score: shortString(e, "score", "evaluation.score"),
    cost: shortString(e, "cost", "evaluation.cost"),
    duration: shortString(e, "duration", "evaluation.duration"),
    summaryTitle: shortString(e, "summaryTitle", "evaluation.summaryTitle"),
    summary: shortString(e, "summary", "evaluation.summary"),
    cases: e.cases.map((raw, i) => {
      const c = asObject(raw, `evaluation.cases[${i}]`);
      return {
        id: shortString(c, "id", `evaluation.cases[${i}].id`),
        score: shortString(c, "score", `evaluation.cases[${i}].score`),
        cost: shortString(c, "cost", `evaluation.cases[${i}].cost`),
        duration: shortString(c, "duration", `evaluation.cases[${i}].duration`),
        sessionIds: stringList(c.sessionIds, `evaluation.cases[${i}].sessionIds`, MAX_FACT_RUNS),
      };
    }),
  };
}

function caseFacts(raw: unknown): AskCaseFacts {
  const c = asObject(raw, "case");
  const caseId = requireString(c, "caseId", { minLen: 1, maxLen: 100, label: "case.caseId" });
  if (!/^CASE-[A-Za-z0-9_-]+$/.test(caseId)) throw badRequest("case.caseId must be a case id.");
  if (c.latest === null || c.latest === undefined) return { caseId, latest: null };
  const latest = asObject(c.latest, "case.latest");
  if (!Array.isArray(latest.runs) || latest.runs.length > MAX_FACT_RUNS) {
    throw badRequest(`case.latest.runs must be an array of at most ${MAX_FACT_RUNS} runs.`);
  }
  return {
    caseId,
    latest: {
      time: shortString(latest, "time", "case.latest.time"),
      score: shortString(latest, "score", "case.latest.score"),
      runs: latest.runs.map((raw, i) => {
        const r = asObject(raw, `case.latest.runs[${i}]`);
        return {
          score: shortString(r, "score", `case.latest.runs[${i}].score`),
          sessionId: shortString(r, "sessionId", `case.latest.runs[${i}].sessionId`),
        };
      }),
    },
  };
}

/** Reads a start form's body; anything out of shape is a 400 naming the field. */
export function parseTaskRequest(body: Record<string, unknown>): ParsedTask {
  const kind = body.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    throw badRequest(`kind must be one of ${KINDS.join(", ")}.`);
  }
  const approvalMode = body.approvalMode ?? "allow-all";
  if (
    typeof approvalMode !== "string" ||
    !(APPROVAL_MODES as readonly string[]).includes(approvalMode)
  ) {
    throw badRequest(`approvalMode must be one of ${APPROVAL_MODES.join(", ")}.`);
  }
  const language = body.language ?? "en";
  if (language !== "en" && language !== "zh") throw badRequest('language must be "en" or "zh".');
  const common: TaskCommon = {
    agentId: requireId(body, "agentId"),
    approvalMode: approvalMode as ApprovalMode,
    ...(body.model !== undefined && body.model !== null
      ? { model: modelOf(body.model, "model") }
      : {}),
    language,
  };
  const notes = optionalString(body, "notes", { maxLen: MAX_NOTES }) ?? "";
  switch (kind as WorkbenchTaskKind) {
    case "create":
      return { ...common, kind: "create", targetAgentId: requireId(body, "targetAgentId"), notes };
    case "import": {
      const source = requireString(body, "source", { maxLen: MAX_SOURCE });
      if (source.trim() === "") throw badRequest("source must not be blank.");
      return { ...common, kind: "import", source };
    }
    case "evaluate": {
      const runs = optionalInteger(body, "runs", 1, 1000);
      if (runs === undefined) throw badRequest("runs must be an integer between 1 and 1000.");
      return {
        ...common,
        kind: "evaluate",
        benchmarkId: requireId(body, "benchmarkId"),
        targetAgentId: requireId(body, "targetAgentId"),
        runs,
        testedModel: modelOf(body.testedModel, "testedModel"),
        notes,
      };
    }
    case "optimize": {
      const method = requireString(body, "method", { minLen: 1, maxLen: MAX_SHORT });
      const runs = optionalInteger(body, "runs", 1, 1000);
      const roundLimit = optionalInteger(body, "roundLimit", 1, 100);
      const targetScore = optionalInteger(body, "targetScore", 1, 100);
      const testRepetitions = optionalInteger(body, "testRepetitions", 1, 100);
      return {
        ...common,
        kind: "optimize",
        benchmarkId: requireId(body, "benchmarkId"),
        targetAgentId: requireId(body, "targetAgentId"),
        method,
        testedModel: modelOf(body.testedModel, "testedModel"),
        ...(runs !== undefined ? { runs } : {}),
        ...(roundLimit !== undefined ? { roundLimit } : {}),
        ...(targetScore !== undefined ? { targetScore } : {}),
        ...(testRepetitions !== undefined ? { testRepetitions } : {}),
        notes,
      };
    }
    case "ask": {
      const question = requireString(body, "question", { maxLen: MAX_NOTES });
      const hasEvaluation = body.evaluation !== undefined && body.evaluation !== null;
      const hasCase = body.case !== undefined && body.case !== null;
      if (hasEvaluation === hasCase) {
        throw badRequest("An ask names exactly one of evaluation and case.");
      }
      return {
        ...common,
        kind: "ask",
        benchmarkId: requireId(body, "benchmarkId"),
        question,
        ...(hasEvaluation ? { evaluation: evaluationFacts(body.evaluation) } : {}),
        ...(hasCase ? { case: caseFacts(body.case) } : {}),
      };
    }
  }
}

/** The Benchmark a request is about, when it names one. */
export function benchmarkOf(task: ParsedTask): string | undefined {
  return "benchmarkId" in task ? task.benchmarkId : undefined;
}

/** The Agents a request names (the one carrying it out, and the Test Agent where there is one). */
export function agentsOf(task: ParsedTask): string[] {
  return "targetAgentId" in task ? [task.agentId, task.targetAgentId] : [task.agentId];
}

/**
 * The spec the prompt is built from: the request with the Benchmark's folder and, for Optimize,
 * the method the library offers under the requested plugin (400 `method_unknown` for one it does
 * not; the default loop stays available while the library cannot be read).
 */
export function specOf(
  task: ParsedTask,
  benchmarkDir: string | undefined,
  methods: readonly WorkbenchMethod[],
  benchmarkRuns: number,
): TaskSpec {
  const dir = benchmarkDir ?? "";
  switch (task.kind) {
    case "create":
      return { kind: "create", targetAgentId: task.targetAgentId, notes: task.notes };
    case "import":
      return { kind: "import", source: task.source };
    case "evaluate":
      return {
        kind: "evaluate",
        benchmarkId: task.benchmarkId,
        benchmarkDir: dir,
        targetAgentId: task.targetAgentId,
        runs: task.runs,
        provider: task.testedModel.provider,
        modelId: task.testedModel.modelId,
        notes: task.notes,
      };
    case "optimize": {
      const method =
        methods.find((m) => m.plugin === task.method) ??
        (task.method === DEFAULT_TOOLKIT_PLUGIN ? DEFAULT_METHOD : undefined);
      if (method === undefined) {
        throw new WorkbenchError(
          400,
          "method_unknown",
          `The plugin library offers no self-evolution method named ${task.method}.`,
        );
      }
      if (
        method.kind === "default" &&
        (task.roundLimit === undefined || task.targetScore === undefined)
      ) {
        throw badRequest("The default loop takes roundLimit and targetScore.");
      }
      return {
        kind: "optimize",
        method,
        benchmarkId: task.benchmarkId,
        benchmarkDir: dir,
        targetAgentId: task.targetAgentId,
        provider: task.testedModel.provider,
        modelId: task.testedModel.modelId,
        runs: task.runs ?? benchmarkRuns,
        roundLimit: task.roundLimit ?? 0,
        targetScore: task.targetScore ?? 0,
        testRepetitions: task.testRepetitions ?? 3,
        notes: task.notes,
      };
    }
    case "ask":
      return {
        kind: "ask",
        benchmarkId: task.benchmarkId,
        benchmarkDir: dir,
        question: task.question,
        ...(task.evaluation !== undefined ? { evaluation: task.evaluation } : {}),
        ...(task.case !== undefined ? { case: task.case } : {}),
      };
  }
}

/** Where a task stands, from the host's view of its conversation. */
export function stateOf(status: AgentTaskStatus | null): TaskState {
  if (status === null) return "gone";
  if (status.pendingApprovals > 0) return "waiting";
  if (status.status === "running" || status.status === "compacting") return "running";
  if (status.failed === true || status.status === "failed" || status.status === "error") {
    return "failed";
  }
  return "done";
}

/** A task line of `tasks.jsonl`. */
export interface TaskRecord {
  sessionId: string;
  kind: WorkbenchTaskKind;
  benchmarkId?: string;
  agentId: string;
  userId: string;
  approvalMode: ApprovalMode;
  createdAt: string;
}

/**
 * A settle line of `tasks.jsonl`: how a task ended as the host answered for one viewer (`gone`:
 * no conversation they can open), kept so that the host is asked about a task only while it runs.
 */
export interface SettledRecord {
  settled: string;
  viewer: string;
  state: "done" | "failed" | "gone";
  title?: string;
  at: string;
}

/** A task line, with how it ended for the viewer when that is already recorded. */
export interface ListedTask {
  record: TaskRecord;
  settled: SettledRecord | null;
}

const TASKS_FILE = "tasks.jsonl";
const SETTLED_STATES: readonly SettledRecord["state"][] = ["done", "failed", "gone"];

function isRecord(v: unknown): v is TaskRecord {
  const r = v as Partial<TaskRecord> | null;
  return (
    r !== null &&
    typeof r === "object" &&
    typeof r.sessionId === "string" &&
    typeof r.kind === "string" &&
    (KINDS as readonly string[]).includes(r.kind) &&
    typeof r.agentId === "string" &&
    typeof r.userId === "string" &&
    typeof r.approvalMode === "string" &&
    typeof r.createdAt === "string" &&
    (r.benchmarkId === undefined || typeof r.benchmarkId === "string")
  );
}

function isSettled(v: unknown): v is SettledRecord {
  const r = v as Partial<SettledRecord> | null;
  return (
    r !== null &&
    typeof r === "object" &&
    typeof r.settled === "string" &&
    typeof r.viewer === "string" &&
    typeof r.state === "string" &&
    SETTLED_STATES.includes(r.state) &&
    (r.title === undefined || typeof r.title === "string") &&
    typeof r.at === "string"
  );
}

/** Whether `file` is there and its last line has no newline yet. */
async function endsTorn(file: string): Promise<boolean> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * The record of tasks started from the workbench, per Project, in that Project's state folder. An
 * append is one write of one line, so two starts at once never interleave; a line that does not
 * read (a crash mid-write) is skipped, never fatal, and the next record starts on a fresh line.
 */
export class TaskLog {
  constructor(private readonly stateDirOf: (projectId: string) => Promise<string>) {}

  async append(projectId: string, record: TaskRecord | SettledRecord): Promise<void> {
    const dir = await this.stateDirOf(projectId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, TASKS_FILE);
    // A line torn by a crash ends without a newline; start on a line of its own, or the torn
    // line would swallow this record too.
    const torn = await endsTorn(file);
    await fs.appendFile(file, `${torn ? "\n" : ""}${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  /**
   * Newest first, at most `limit` tasks, those about `benchmarkId` when it is given, each with
   * how it ended for `viewer` when a settle line says so.
   */
  async list(
    projectId: string,
    filter: { benchmarkId?: string; viewer?: string } = {},
    limit = TASK_LIST_LIMIT,
  ): Promise<ListedTask[]> {
    let text: string;
    try {
      text = await fs.readFile(path.join(await this.stateDirOf(projectId), TASKS_FILE), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: TaskRecord[] = [];
    const settled = new Map<string, SettledRecord>();
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRecord(parsed)) records.push(parsed);
      else if (isSettled(parsed) && parsed.viewer === filter.viewer) {
        settled.set(parsed.settled, parsed);
      }
    }
    const out: ListedTask[] = [];
    for (let i = records.length - 1; i >= 0 && out.length < limit; i--) {
      const record = records[i]!;
      if (filter.benchmarkId !== undefined && record.benchmarkId !== filter.benchmarkId) continue;
      out.push({ record, settled: settled.get(record.sessionId) ?? null });
    }
    return out;
  }
}

/**
 * How a task ended, from the host's answer for `viewer`, as a settle line to keep; null while it
 * is still under way (or waiting on an approval), which is asked again next time.
 */
export function settledOf(
  sessionId: string,
  viewer: string,
  status: AgentTaskStatus | null,
): SettledRecord | null {
  const state = stateOf(status);
  if (state !== "done" && state !== "failed" && state !== "gone") return null;
  const title = typeof status?.title === "string" && status.title !== "" ? status.title : undefined;
  return {
    settled: sessionId,
    viewer,
    state,
    ...(title !== undefined ? { title } : {}),
    at: new Date().toISOString(),
  };
}

/** A task as a settle line ended it: no host read. */
export function settledTaskOf(record: TaskRecord, settled: SettledRecord): WorkbenchTask {
  return {
    ...record,
    state: settled.state,
    ...(settled.title !== undefined ? { title: settled.title } : {}),
    pendingApprovals: 0,
  };
}

/** A record with where its conversation stands, as the page lists it. */
export function taskOf(record: TaskRecord, status: AgentTaskStatus | null): WorkbenchTask {
  const title = typeof status?.title === "string" && status.title !== "" ? status.title : undefined;
  return {
    ...record,
    state: stateOf(status),
    ...(title !== undefined ? { title } : {}),
    pendingApprovals: status?.pendingApprovals ?? 0,
  };
}
