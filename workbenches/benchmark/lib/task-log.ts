/**
 * The tasks the page started from this workbench, kept in the workbench's own state document
 * (`host.getState()` / `host.setState()`, `state.json`, which the host keeps across reloads and
 * rollbacks). The page starts a task as the person who pressed Start, through the Web App's own
 * routes, and then records it here (`POST …/tasks`): which conversation, what kind, which
 * Benchmark, which Agent, which approval mode, and when. Where each conversation stands is the
 * page's to read (`GET /api/sessions/:id`), as the viewer: the handler knows no viewer, and a
 * conversation the viewer cannot read is the page's to leave out.
 *
 * Writes run one at a time, so two records sent at once both land. The newest `MAX_TASKS` are
 * kept; the state's other keys are left as they are.
 */
import type { ApprovalMode, TaskRecord, TaskRecordRequest, WorkbenchTaskKind } from "./api.js";
import { badRequest } from "./errors.js";
import { isValidId } from "./format/ids.js";
import { TASK_KINDS } from "./prompt-request.js";
import { requireString } from "./validate.js";

/** What the workbench's state document holds of these, as far as this module reads it. */
export interface TaskHost {
  getState(): unknown;
  setState(state: unknown): Promise<void>;
}

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

/** How many records a list answers, newest first. */
export const TASK_LIST_LIMIT = 50;
/** How many records the state keeps; older ones are dropped as new ones arrive. */
export const MAX_TASKS = 500;

/** A Session id as the host mints them: no separators, no control characters. */
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

function isTaskRecord(v: unknown): v is TaskRecord {
  const r = v as Partial<TaskRecord> | null;
  return (
    r !== null &&
    typeof r === "object" &&
    typeof r.sessionId === "string" &&
    typeof r.kind === "string" &&
    (TASK_KINDS as readonly string[]).includes(r.kind) &&
    typeof r.agentId === "string" &&
    typeof r.approvalMode === "string" &&
    typeof r.createdAt === "string" &&
    (r.benchmarkId === undefined || typeof r.benchmarkId === "string")
  );
}

/** Reads a record request; anything out of shape is a 400 naming the field. */
export function parseTaskRecord(body: Record<string, unknown>): TaskRecordRequest {
  const sessionId = requireString(body, "sessionId", { minLen: 1, maxLen: 200 });
  if (!SESSION_ID.test(sessionId)) throw badRequest("sessionId is not a Session id.");
  const kind = body.kind;
  if (typeof kind !== "string" || !(TASK_KINDS as readonly string[]).includes(kind)) {
    throw badRequest(`kind must be one of ${TASK_KINDS.join(", ")}.`);
  }
  const agentId = requireString(body, "agentId", { minLen: 1, maxLen: 100 });
  if (!isValidId(agentId))
    throw badRequest('agentId may only contain letters, digits, "_" and "-".');
  const approvalMode = body.approvalMode;
  if (
    typeof approvalMode !== "string" ||
    !(APPROVAL_MODES as readonly string[]).includes(approvalMode)
  ) {
    throw badRequest(`approvalMode must be one of ${APPROVAL_MODES.join(", ")}.`);
  }
  let benchmarkId: string | undefined;
  if (body.benchmarkId !== undefined && body.benchmarkId !== null) {
    benchmarkId = requireString(body, "benchmarkId", { minLen: 1, maxLen: 100 });
    if (!isValidId(benchmarkId)) {
      throw badRequest('benchmarkId may only contain letters, digits, "_" and "-".');
    }
  }
  return {
    sessionId,
    kind: kind as WorkbenchTaskKind,
    ...(benchmarkId !== undefined ? { benchmarkId } : {}),
    agentId,
    approvalMode: approvalMode as ApprovalMode,
  };
}

export class TaskLog {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: TaskHost) {}

  /** The state document as an object; a missing or foreign one reads as empty. */
  private state(): Record<string, unknown> {
    const state = this.host.getState();
    return state !== null && typeof state === "object" && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};
  }

  /** The records in the state, oldest first; one out of shape is skipped, never fatal. */
  private records(): TaskRecord[] {
    const tasks = this.state().tasks;
    return Array.isArray(tasks) ? tasks.filter(isTaskRecord) : [];
  }

  /** Records a started task, stamped now; resolves once the state holds it. */
  append(request: TaskRecordRequest, now: Date = new Date()): Promise<TaskRecord> {
    const record: TaskRecord = { ...request, createdAt: now.toISOString() };
    const write = this.pending.then(async () => {
      const tasks = [...this.records(), record].slice(-MAX_TASKS);
      await this.host.setState({ ...this.state(), tasks });
      return record;
    });
    this.pending = write.catch(() => undefined);
    return write;
  }

  /** Newest first, at most `limit`, those about `benchmarkId` when it is given. */
  list(benchmarkId?: string, limit = TASK_LIST_LIMIT): TaskRecord[] {
    const out: TaskRecord[] = [];
    const records = this.records();
    for (let i = records.length - 1; i >= 0 && out.length < limit; i--) {
      const record = records[i]!;
      if (benchmarkId !== undefined && record.benchmarkId !== benchmarkId) continue;
      out.push(record);
    }
    return out;
  }
}
