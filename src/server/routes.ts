/**
 * The workbench's routes, mounted by the host at `/api/projects/:projectId/benchmarks` behind its
 * sign-in (`HttpModule.routes`, `auth: "user"`). The data routes are the Evaluation Center's,
 * moved from the harness unchanged (packages/server http/routes/benchmarks.ts); the page's own
 * reads and its tasks are new (PRFC-0036, "Contributions"):
 *
 *   GET    /                                           this server's Benchmarks (any member);
 *                                                      `?machine=<id>` one machine's (an admin)
 *   POST   /                                           create one by hand (owner)
 *   DELETE /:benchmarkId                               remove one whole (owner)
 *   POST   /archive                                    import a package from a zip (any member)
 *   GET    /:benchmarkId/archive                       export the package (any member)
 *   GET    /:benchmarkId/cases                         its cases here; `?machine=<id>` a machine's
 *   GET    /:benchmarkId/cases/:caseId/files           a case's statement files
 *   GET    /:benchmarkId/cases/:caseId/files/content
 *   GET    /:benchmarkId/cases/:caseId/rubric/files    a case's rubric files
 *   GET    /:benchmarkId/cases/:caseId/rubric/files/content
 *   GET    /context                                    what the page needs to know (any member)
 *   POST   /tasks                                      start an Agent task (any member, as a
 *                                                      person); `?preview=1` answers the prompt
 *   GET    /tasks?benchmarkId=                         the tasks started here, newest first
 *                                                      (the host asked only about live ones)
 *
 * An admin's page merges this server's list with each machine's as the answers land, so no
 * machine holds back this server's rows (../merge.ts). A refusal answers
 * `{ error: { code, message, details? } }`, as the host's own routes do.
 */
import { Hono, type Context } from "hono";
import type {
  BenchmarkArchiveGitOrigin,
  BenchmarkArchiveImportResponse,
  BenchmarkCasesResponse,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseMaterial,
  TaskPreviewResponse,
  TaskStartResponse,
  TasksResponse,
  WorkbenchAgent,
  WorkbenchContext,
  WorkbenchMethod,
} from "../api.js";
import { isValidId } from "../format/ids.js";
import { WorkbenchError, badRequest, errorFields } from "./errors.js";
import type {
  AgentSkills,
  AgentTaskStatus,
  AgentTasks,
  PluginCatalog,
  ProjectAccess,
  ProjectAgents,
  ProjectMachines,
  ProjectModels,
} from "./host.js";
import { askMachine, benchmarksAnswer, casesAnswer } from "./merge.js";
import { pluginShipping, rsiMethods } from "./methods.js";
import { benchmarkFolder, buildRequest } from "./prompts.js";
import type { BenchmarkCaseInput, BenchmarkStore } from "./service.js";
import {
  agentsOf,
  benchmarkOf,
  parseTaskRequest,
  settledOf,
  settledTaskOf,
  specOf,
  taskOf,
  type SettledRecord,
  type TaskLog,
  type TaskRecord,
} from "./tasks.js";
import {
  isHttpUrl,
  optionalInteger,
  optionalString,
  readJson,
  requireString,
  requireText,
  requireValidId,
} from "./validate.js";
import { MAX_ARCHIVE_BYTES } from "./zip-guards.js";
import { benchmarkTooLarge } from "./archive.js";

/** What the host's sign-in leaves on a request. */
export interface RouteEnv {
  Variables: {
    user: { userId: string; isAdmin: boolean };
    /** How the session was established; `token` is the local API token an Agent's shell holds. */
    sessionVia: string;
  };
}

type C = Context<RouteEnv>;

export interface WorkbenchRouteDeps {
  store: BenchmarkStore;
  /** The Project's Benchmark folder (absolute). */
  dirOf(projectId: string): Promise<string>;
  access: ProjectAccess;
  agents: ProjectAgents;
  skills: AgentSkills;
  models: ProjectModels;
  library: PluginCatalog;
  machines: ProjectMachines;
  tasks: AgentTasks;
  log: TaskLog;
}

/** The Agent a task goes to unless its form says otherwise. */
const DEFAULT_AGENT_ID = "default_agent";

const TEXT_PREVIEW_BYTES = 256 * 1024;

/** Case directories carry the `CASE-` prefix the reader lists by; the rest is the id alphabet. */
const CASE_ID_PATTERN = /^CASE-[A-Za-z0-9_-]+$/;
const MAX_CASES = 100;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
/** Statement and rubric bodies: generous, but a hand-written case is a page, not a corpus. */
const MAX_BODY = 100_000;
/**
 * Runs per case. Every run is one evaluation of the Test Agent, so the count multiplies the cost
 * of each optimization round; a stored value has to stay within it to remain usable.
 */
const MAX_RUNS = 1000;

/** The longest `dataBase64` a zip within the 14MB cap encodes to, refused before it is decoded. */
const MAX_ARCHIVE_BASE64 = Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4;

/** The only `ref` a git origin records: a commit, since a branch or a tag can move. */
const COMMIT = /^[0-9a-f]{40}$/;

/** Refuses the local API token: an Agent's shell must not start a task in a person's name. */
function requireHuman(c: C): void {
  if (c.var.sessionVia === "token") {
    throw new WorkbenchError(
      403,
      "human_required",
      "This takes a person's sign-in; the local API token cannot do it.",
    );
  }
}

/**
 * An import request's `origin`: absent, or the repository folder the package was fetched from —
 * an http(s) link, the 40-character commit it resolved to and the folder inside the repository.
 * The server never fetches them: they go into the copy's manifest.
 */
function optionalGitOrigin(body: Record<string, unknown>): BenchmarkArchiveGitOrigin | undefined {
  const raw = body.origin;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("origin must be an object.");
  const origin = raw as Record<string, unknown>;
  if (origin.kind !== "git") throw badRequest('origin.kind must be "git".');
  const url = requireString(origin, "url", { minLen: 1, maxLen: 2048, label: "origin.url" });
  if (!isHttpUrl(url)) throw badRequest("origin.url must be an http(s) link.");
  const ref = requireString(origin, "ref", { label: "origin.ref" });
  if (!COMMIT.test(ref)) throw badRequest("origin.ref must be a 40-character commit id.");
  const folder = requireString(origin, "path", { minLen: 1, maxLen: 1024, label: "origin.path" });
  return { kind: "git", url, ref, path: folder };
}

/** The `cases` of a create request: non-empty, capped, unique `CASE-…` ids, every text present. */
function requireCases(body: Record<string, unknown>): BenchmarkCaseInput[] {
  const raw = body.cases;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("cases must be a non-empty array.");
  if (raw.length > MAX_CASES) throw badRequest(`cases must hold at most ${MAX_CASES} entries.`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`cases[${i}] must be an object.`);
    }
    const c = item as Record<string, unknown>;
    const id = requireString(c, "id", { maxLen: 100, label: `cases[${i}].id` });
    if (!CASE_ID_PATTERN.test(id)) {
      throw badRequest(
        `cases[${i}].id must start with "CASE-" and use only letters, digits, "_" and "-".`,
      );
    }
    if (seen.has(id)) throw badRequest(`cases[${i}].id is a duplicate: ${id}`);
    seen.add(id);
    return {
      id,
      title: requireText(c, "title", MAX_TITLE, `cases[${i}].title`),
      statement: requireText(c, "statement", MAX_BODY, `cases[${i}].statement`),
      rubric: requireText(c, "rubric", MAX_BODY, `cases[${i}].rubric`),
    };
  });
}

/** The Project in the path, once the user may see it; their role in it. */
function projectOf(c: C, deps: WorkbenchRouteDeps): { projectId: string; role: string } {
  const projectId = requireValidId(c, "projectId");
  const { role } = deps.access.requireProjectAccess(c.var.user.userId, projectId);
  return { projectId, role };
}

/**
 * One machine's answer to `GET path` of its own API, for an admin (as the host's machine proxy):
 * 403 for anyone else, 404 for a machine the Project does not use, 502 when it gives no answer
 * within the deadline (not connected, or anything but the list it was asked for).
 */
async function fromMachine<T>(
  c: C,
  deps: WorkbenchRouteDeps,
  projectId: string,
  machineId: string,
  path: string,
  accept: (body: unknown) => T | null,
): Promise<T> {
  if (!c.var.user.isAdmin) {
    throw new WorkbenchError(403, "admin_required", "Only an admin can read a machine's copies.");
  }
  const machines = await deps.machines.projectApis(projectId);
  const machine = machines.find((m) => m.machineId === machineId);
  if (machine === undefined) {
    throw new WorkbenchError(404, "machine_not_found", "The Project uses no such machine.");
  }
  const answer = await askMachine(machine.api, path, accept);
  if (answer === null) {
    throw new WorkbenchError(
      502,
      "machine_unreachable",
      `Machine ${machine.alias} did not answer; its copies are not listed.`,
      undefined,
      { machineId },
    );
  }
  return answer;
}

/** The RSI methods the library offers; none while it cannot be read. */
function methodsOf(deps: WorkbenchRouteDeps): WorkbenchMethod[] {
  try {
    return rsiMethods(deps.library.list());
  } catch {
    return [];
  }
}

function listCaseFiles(deps: WorkbenchRouteDeps, material: CaseMaterial) {
  return async (c: C) => {
    const { projectId } = projectOf(c, deps);
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    return c.json(
      await deps.store.listCaseFiles(
        projectId,
        benchmarkId,
        caseId,
        c.req.query("path") ?? "",
        material,
      ),
    );
  };
}

function readCaseFile(deps: WorkbenchRouteDeps, material: CaseMaterial) {
  return async (c: C) => {
    const { projectId } = projectOf(c, deps);
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    const download = c.req.query("download") === "1";
    const boundedPreview = !download && c.req.query("preview") === "1";
    const { data, fileName, contentType, scriptable, truncated } = await deps.store.readCaseFile(
      projectId,
      benchmarkId,
      caseId,
      c.req.query("path") ?? "",
      material,
      boundedPreview ? { maxBytes: TEXT_PREVIEW_BYTES } : undefined,
    );
    // Case material is browsed the way a Workspace is, and gets the same inline hardening: HTML
    // is shown as text, an SVG keeps its type for an <img> but is inert when opened directly.
    const inertSvg = !download && scriptable === "svg";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type":
          !download && scriptable === "html" ? "text/plain; charset=utf-8" : contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        ...(inertSvg ? { "Content-Security-Policy": "sandbox" } : {}),
        ...(truncated ? { "X-Content-Truncated": "1" } : {}),
      },
    });
  };
}

export function workbenchRoutes(deps: WorkbenchRouteDeps): Hono<RouteEnv> {
  const app = new Hono<RouteEnv>();

  app.onError((err, c) => {
    const { status, code, message, details } = errorFields(err);
    if (status === 500) {
      console.error(
        `[rsi-workbench] ${c.req.method} ${c.req.path}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
    return c.json(
      { error: { code, message, ...(details !== undefined ? { details } : {}) } },
      status as 400,
    );
  });

  // This server's list; `?local=1` (what an older hub asks) is the same answer.
  app.get("/", async (c) => {
    const { projectId } = projectOf(c, deps);
    const machineId = c.req.query("machine");
    if (machineId === undefined) return c.json(await deps.store.list(projectId));
    const benchmarks = await fromMachine(
      c,
      deps,
      projectId,
      machineId,
      `/api/projects/${encodeURIComponent(projectId)}/benchmarks?local=1`,
      benchmarksAnswer,
    );
    return c.json({ benchmarks: [...benchmarks] } satisfies BenchmarksResponse);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    // Writing into the Project's Benchmarks is Project management: owner only.
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const id = requireString(body, "id", { minLen: 1, maxLen: 100 });
    if (!isValidId(id)) throw badRequest('id may only contain letters, digits, "_" and "-".');
    const title = requireText(body, "title", MAX_TITLE, "title");
    const description = optionalString(body, "description", { maxLen: MAX_DESCRIPTION });
    const runs = optionalInteger(body, "runs", 1, MAX_RUNS) ?? 1;
    const cases = requireCases(body);
    const benchmark = await deps.store.create(projectId, {
      id,
      title,
      ...(description !== undefined ? { description } : {}),
      runs,
      cases,
    });
    return c.json({ benchmark } satisfies BenchmarkCreateResponse, 201);
  });

  app.get("/context", async (c) => {
    const { projectId, role } = projectOf(c, deps);
    const { user } = c.var;
    const [listed, table, machines] = await Promise.all([
      deps.agents.listAgents(projectId),
      deps.models.getModels(projectId),
      user.isAdmin ? deps.machines.projectApis(projectId) : Promise.resolve([]),
    ]);
    const conversation = listed.filter((agent) => agent.system !== true);
    const agents: WorkbenchAgent[] = await Promise.all(
      conversation.map(async (agent) => ({
        agentId: agent.agentId,
        ...(agent.name !== undefined ? { name: agent.name } : {}),
        ...(agent.description !== undefined ? { description: agent.description } : {}),
        ...(agent.avatarRev !== undefined ? { avatarRev: agent.avatarRev } : {}),
        // An Agent whose Skills cannot be read shows none: a start then names what is missing.
        skills: await deps.skills.installedSkills(projectId, agent.agentId).catch(() => []),
      })),
    );
    const defaultAgentId =
      agents.find((agent) => agent.agentId === DEFAULT_AGENT_ID)?.agentId ??
      agents[0]?.agentId ??
      null;
    return c.json({
      projectId,
      role: role === "owner" ? "owner" : "member",
      isAdmin: user.isAdmin,
      dir: await deps.dirOf(projectId),
      agents,
      defaultAgentId,
      models: table.models.map((model) => ({
        provider: model.provider,
        modelId: model.modelId,
        ...(model.displayName !== undefined && model.displayName !== ""
          ? { displayName: model.displayName }
          : {}),
      })),
      defaultModel:
        table.defaultModel !== undefined
          ? { provider: table.defaultModel.provider, modelId: table.defaultModel.modelId }
          : null,
      methods: methodsOf(deps),
      machines: machines.map(({ machineId, alias }) => ({ machineId, label: alias })),
    } satisfies WorkbenchContext);
  });

  app.post("/tasks", async (c) => {
    const { projectId } = projectOf(c, deps);
    const { user } = c.var;
    const preview = c.req.query("preview") === "1";
    if (!preview) requireHuman(c);
    const task = parseTaskRequest(await readJson(c));
    const dir = await deps.dirOf(projectId);
    const benchmarkId = benchmarkOf(task);
    let benchmarkDir: string | undefined;
    let benchmarkRuns = 1;
    if (benchmarkId !== undefined) {
      const held = await deps.store.get(projectId, benchmarkId);
      benchmarkDir = benchmarkFolder(dir, benchmarkId, held !== null);
      benchmarkRuns = held?.runs ?? 1;
    }
    const methods = task.kind === "optimize" ? methodsOf(deps) : [];
    const built = buildRequest(
      specOf(task, benchmarkDir, methods, benchmarkRuns),
      task.language,
      projectId,
      dir,
    );
    if (preview) {
      return c.json({ prompt: built.prompt, skills: built.skills } satisfies TaskPreviewResponse);
    }

    const listed = await deps.agents.listAgents(projectId);
    for (const agentId of agentsOf(task)) {
      const agent = listed.find((a) => a.agentId === agentId);
      if (agent === undefined) {
        throw new WorkbenchError(404, "not_found", `Agent does not exist: ${agentId}`);
      }
      if (agent.system === true) {
        throw new WorkbenchError(
          409,
          "system_agent_no_sessions",
          "The system Agent runs no conversation; choose another Agent.",
        );
      }
    }
    const installed = await deps.skills.installedSkills(projectId, task.agentId);
    for (const skill of built.required) {
      if (installed.includes(skill)) continue;
      let library: ReturnType<PluginCatalog["list"]> = [];
      try {
        library = deps.library.list();
      } catch {
        // The plugin is named when the library can say which one ships the Skill.
      }
      const plugin = pluginShipping(library, skill);
      throw new WorkbenchError(
        409,
        "skill_missing",
        `Agent ${task.agentId} does not have the ${skill} Skill installed${plugin !== null ? `; install the ${plugin} plugin on it first` : ""}.`,
        undefined,
        { agentId: task.agentId, skill, ...(plugin !== null ? { plugin } : {}) },
      );
    }
    const { sessionId } = await deps.tasks.start({
      userId: user.userId,
      projectId,
      agentId: task.agentId,
      prompt: built.prompt,
      approvalMode: task.approvalMode,
      skills: built.skills.filter((skill) => installed.includes(skill)),
      ...(task.model !== undefined ? { model: task.model } : {}),
    });
    const record: TaskRecord = {
      sessionId,
      kind: task.kind,
      ...(benchmarkId !== undefined ? { benchmarkId } : {}),
      agentId: task.agentId,
      userId: user.userId,
      approvalMode: task.approvalMode,
      createdAt: new Date().toISOString(),
    };
    await deps.log.append(projectId, record);
    // Just started: a host that has not settled its state yet reads as running.
    const status = await deps.tasks.status(user.userId, sessionId).catch(() => null);
    return c.json(
      {
        task: taskOf(record, status ?? { status: "running", pendingApprovals: 0 }),
      } satisfies TaskStartResponse,
      201,
    );
  });

  app.get("/tasks", async (c) => {
    const { projectId } = projectOf(c, deps);
    const benchmarkId = c.req.query("benchmarkId");
    if (benchmarkId !== undefined && !isValidId(benchmarkId)) {
      throw badRequest('benchmarkId may only contain letters, digits, "_" and "-".');
    }
    const viewer = c.var.user.userId;
    const listed = await deps.log.list(projectId, {
      viewer,
      ...(benchmarkId !== undefined ? { benchmarkId } : {}),
    });
    // Only a task still under way when last asked is asked of the host; one that ended is read
    // from its settle line, written the first time the host said so.
    const ended: SettledRecord[] = [];
    const tasks = await Promise.all(
      listed.map(async ({ record, settled }) => {
        if (settled !== null) return settledTaskOf(record, settled);
        let status: AgentTaskStatus | null;
        try {
          status = await deps.tasks.status(viewer, record.sessionId);
        } catch {
          // No answer this time: not listed, and asked again next time.
          return taskOf(record, null);
        }
        const settle = settledOf(record.sessionId, viewer, status);
        if (settle !== null) ended.push(settle);
        return taskOf(record, status);
      }),
    );
    for (const settle of ended) await deps.log.append(projectId, settle);
    return c.json({
      tasks: tasks.filter((task) => task.state !== "gone"),
    } satisfies TasksResponse);
  });

  app.delete("/:benchmarkId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.store.remove(projectId, benchmarkId);
    return c.body(null, 204);
  });

  // Import a package from a zip: open to every member, since a Benchmark belongs to the Project
  // and anyone in it may bring one in. With `overwrite` it replaces a Benchmark of the same id
  // whole, evaluation records included — the page says so before it sends one.
  app.post("/archive", async (c) => {
    const { projectId } = projectOf(c, deps);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64");
    // The same 413 the decoded size would get, answered before a byte is decoded.
    if (dataBase64.length > MAX_ARCHIVE_BASE64) {
      throw benchmarkTooLarge("The zip archive exceeds the 14MB limit.");
    }
    const origin = optionalGitOrigin(body);
    const benchmark = await deps.store.importArchive(projectId, Buffer.from(dataBase64, "base64"), {
      overwrite: body.overwrite === true,
      ...(origin !== undefined ? { origin } : {}),
    });
    return c.json({ benchmark } satisfies BenchmarkArchiveImportResponse, 201);
  });

  // Export a published Benchmark's package: a binary attachment the import takes back unchanged.
  app.get("/:benchmarkId/archive", async (c) => {
    const { projectId } = projectOf(c, deps);
    const benchmarkId = requireValidId(c, "benchmarkId");
    const { fileName, data } = await deps.store.exportArchive(projectId, benchmarkId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        // An id and a date version: the encoded name is the name itself.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.get("/:benchmarkId/cases", async (c) => {
    const { projectId } = projectOf(c, deps);
    const benchmarkId = requireValidId(c, "benchmarkId");
    const machineId = c.req.query("machine");
    if (machineId === undefined) return c.json(await deps.store.listCases(projectId, benchmarkId));
    const cases = await fromMachine(
      c,
      deps,
      projectId,
      machineId,
      `/api/projects/${encodeURIComponent(projectId)}/benchmarks/${encodeURIComponent(benchmarkId)}/cases?local=1`,
      casesAnswer,
    );
    return c.json({ cases: [...cases] } satisfies BenchmarkCasesResponse);
  });

  app.get("/:benchmarkId/cases/:caseId/files", listCaseFiles(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/files/content", readCaseFile(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files", listCaseFiles(deps, "rubric"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files/content", readCaseFile(deps, "rubric"));

  return app;
}
