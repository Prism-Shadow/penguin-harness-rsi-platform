/**
 * The host a server suite runs the workbench against: one fake per boundary the plugin declares
 * (src/server/host.ts), over a data root in a temp folder outside any checkout, and the plugin's
 * own route groups mounted where the host mounts them. A request names its user with headers the
 * fake sign-in reads (`x-user`, `x-admin: 1`, `x-via: token` for the local API token), as the
 * host's sign-in would leave them on the request.
 *
 * The fakes keep the host's contracts the plugin relies on and nothing else: Project access is a
 * table of owners and members (404 for anyone else, 403 for a non-owner where an owner is
 * required); a machine is another workbench over its own root, reached through the same request
 * shape as the host's machine client; a started task is a record whose state the suite sets.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import { WorkbenchError } from "../../src/server/errors.js";
import type {
  AgentListView,
  AgentTaskStart,
  AgentTaskStatus,
  AppDataPaths,
  CaseFileContent,
  MachineApiView,
} from "../../src/server/host.js";
import { workbenchRoutes, type RouteEnv } from "../../src/server/routes.js";
import { BenchmarkStore } from "../../src/server/service.js";
import { TaskLog } from "../../src/server/tasks.js";
import { uiRoutes } from "../../src/server/ui-files.js";
import type { CaseFilesResponse } from "../../src/api.js";

export const PREFIX = "/api/projects/:projectId/benchmarks";

/** A temp folder outside any checkout, removed by `dispose`. */
export async function tempRoot(prefix = "rsi-workbench-test-"): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

/** The folders the fake AppData answers: the system Agent's, as PRFC-0032/0034 lay them out. */
export function appDataPaths(root: string, projectId: string, appId: string): AppDataPaths {
  const app = path.join(root, "projects", projectId, "agents", "system_agent", "app");
  return {
    dataDir: path.join(app, "data", appId),
    cacheDir: path.join(app, "cache", appId),
    stateDir: path.join(app, "state", appId),
  };
}

const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8",
};

/**
 * The host's bounded file reader, as far as the plugin relies on it: paths stay under the folder
 * once links are resolved (else 404), a listing is one folder's entries, and a bounded read
 * returns the beginning of the file and says so.
 */
export class FakeCaseFiles {
  private async resolve(workspace: string, rel: string): Promise<string> {
    if (rel.includes("\\") || path.isAbsolute(rel) || rel.split("/").includes("..")) {
      throw new WorkbenchError(400, "path_invalid", "Invalid path.");
    }
    try {
      const root = await fs.realpath(workspace);
      const real = await fs.realpath(path.join(workspace, rel));
      if (real !== root && !real.startsWith(root + path.sep)) throw new Error("outside");
      return real;
    } catch {
      throw new WorkbenchError(404, "not_found", "File does not exist.");
    }
  }

  async list(workspace: string, rel: string): Promise<CaseFilesResponse> {
    const dir = await this.resolve(workspace, rel);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      if (stat === null) continue;
      out.push({
        name: entry.name,
        kind: stat.isDirectory() ? ("dir" as const) : ("file" as const),
        sizeBytes: stat.isDirectory() ? 0 : stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    return { path: rel, entries: out };
  }

  async read(
    workspace: string,
    rel: string,
    options?: { maxBytes?: number },
  ): Promise<CaseFileContent> {
    const file = await this.resolve(workspace, rel);
    if (!(await fs.stat(file)).isFile()) {
      throw new WorkbenchError(400, "not_a_file", "Not a file.");
    }
    const all = await fs.readFile(file);
    const max = options?.maxBytes;
    const data = max !== undefined && all.length > max ? all.subarray(0, max) : all;
    const ext = path.extname(file).toLowerCase();
    return {
      data,
      fileName: path.basename(file),
      contentType: MIME[ext] ?? "application/octet-stream",
      scriptable: ext === ".html" ? "html" : ext === ".svg" ? "svg" : false,
      ...(data.length < all.length ? { truncated: true } : {}),
    };
  }
}

/** A Project of the fake host: who owns it, who else may see it, its Agents and models. */
export interface FakeProject {
  owner: string;
  members?: string[];
  agents?: Array<AgentListView & { skills?: string[] }>;
  models?: { provider: string; modelId: string; displayName?: string }[];
  defaultModel?: { provider: string; modelId: string };
}

/** One started task as the fake AgentTasks keeps it. */
export interface StartedTask extends AgentTaskStart {
  sessionId: string;
}

export interface TestHostOptions {
  projects?: Record<string, FakeProject>;
  /** The plugin library's entries (only the fields the plugin reads matter). */
  library?: Array<
    Omit<Partial<LibraryPlugin>, "skills"> & { name: string; skills?: { name: string }[] }
  >;
  /** Library reads fail, as a host whose library is broken. */
  libraryFails?: boolean;
  /** The Project's machines, each another host (or null for one that is not connected). */
  machines?: Record<string, TestHost | null>;
  /** The folder the page's built files are served from. */
  uiDir?: string;
}

export interface RequestAs {
  user?: string;
  admin?: boolean;
  /** `token`: the local API token an Agent's shell holds. */
  via?: string;
}

export interface TestHost {
  root: string;
  app: Hono<RouteEnv>;
  /** Sends a request as `as.user` (default the first Project's owner). */
  request(method: string, url: string, as?: RequestAs, body?: unknown): Promise<Response>;
  /** The Project's Benchmark folder on this host. */
  benchmarksDir(projectId: string): string;
  /** The tasks this host's AgentTasks started, oldest first. */
  started: StartedTask[];
  /** Sets where a started conversation stands, as the host would report it; null: gone. */
  setStatus(sessionId: string, status: AgentTaskStatus | null): void;
  /** Projects can be changed during a test (an Agent installs a Skill, say). */
  projects: Record<string, FakeProject>;
  dispose(): Promise<void>;
}

/** A host with one Project `p1` owned by `alice`, with `bob` a member, unless told otherwise. */
export async function createTestHost(options: TestHostOptions = {}): Promise<TestHost> {
  const root = await tempRoot();
  const projects: Record<string, FakeProject> = options.projects ?? {
    p1: {
      owner: "alice",
      members: ["bob"],
      agents: [
        { agentId: "default_agent", skills: ["agent-evaluation", "benchmark-design"] },
        { agentId: "writer", name: "Writer", skills: [] },
        { agentId: "system_agent", system: true },
      ],
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      ],
      defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    },
  };
  const started: StartedTask[] = [];
  const statuses = new Map<string, AgentTaskStatus | null>();
  let sessions = 0;

  const projectOf = (projectId: string): FakeProject => {
    const project = projects[projectId];
    if (project === undefined) {
      throw new WorkbenchError(
        404,
        "not_found",
        "Project does not exist or you do not have access.",
      );
    }
    return project;
  };
  const benchmarksDir = (projectId: string) => appDataPaths(root, projectId, "benchmark").dataDir;
  const dirOf = async (projectId: string) => benchmarksDir(projectId);

  const machineApis = Object.entries(options.machines ?? {}).map(([machineId, host]) => {
    const api: MachineApiView | null =
      host === null
        ? null
        : {
            async request(method, url) {
              // The hub speaks to a machine as its admin, as the host's machine client does.
              const owner = Object.values(host.projects)[0]?.owner ?? "admin";
              const res = await host.request(method, url, { user: owner, admin: true });
              return { status: res.status, text: await res.text() };
            },
          };
    return { machineId, alias: `${machineId}.example.test`, api };
  });

  const store = new BenchmarkStore({ dirOf, files: new FakeCaseFiles() });
  const routes = workbenchRoutes({
    store,
    dirOf,
    access: {
      requireProjectAccess(userId, projectId) {
        const project = projectOf(projectId);
        if (project.owner === userId) return { role: "owner" };
        if ((project.members ?? []).includes(userId)) return { role: "member" };
        throw new WorkbenchError(
          404,
          "not_found",
          "Project does not exist or you do not have access.",
        );
      },
      requireProjectOwner(userId, projectId) {
        const project = projectOf(projectId);
        if (project.owner !== userId) {
          if (!(project.members ?? []).includes(userId)) {
            throw new WorkbenchError(
              404,
              "not_found",
              "Project does not exist or you do not have access.",
            );
          }
          throw new WorkbenchError(403, "forbidden", "Only the Project's owner can do this.");
        }
      },
    },
    agents: {
      async listAgents(projectId) {
        return (projectOf(projectId).agents ?? []).map(({ skills: _skills, ...agent }) => agent);
      },
    },
    skills: {
      async installedSkills(projectId, agentId) {
        const agent = (projectOf(projectId).agents ?? []).find((a) => a.agentId === agentId);
        if (agent === undefined) throw new WorkbenchError(404, "not_found", "No such Agent.");
        return [...(agent.skills ?? [])];
      },
    },
    models: {
      async getModels(projectId) {
        const project = projectOf(projectId);
        return {
          models: project.models ?? [],
          ...(project.defaultModel !== undefined ? { defaultModel: project.defaultModel } : {}),
        };
      },
    },
    library: {
      list() {
        if (options.libraryFails === true) throw new Error("library unreadable");
        return (options.library ?? []).map((plugin) => ({
          description: "",
          skills: [],
          ...plugin,
        })) as unknown as LibraryPlugin[];
      },
    },
    machines: {
      async projectApis() {
        return machineApis;
      },
    },
    tasks: {
      async start(task) {
        sessions += 1;
        const sessionId = `session-test-${String(sessions).padStart(3, "0")}`;
        started.push({ ...task, sessionId });
        statuses.set(sessionId, { status: "running", title: null, pendingApprovals: 0 });
        return { sessionId };
      },
      async status(userId, sessionId) {
        const task = started.find((t) => t.sessionId === sessionId);
        // A conversation is its owner's: anyone else cannot open it.
        if (task === undefined || task.userId !== userId) return null;
        return statuses.get(sessionId) ?? null;
      },
    },
    log: new TaskLog(async (projectId) => appDataPaths(root, projectId, "benchmark").stateDir),
  });

  const app = new Hono<RouteEnv>();
  // The host's sign-in: who the request is, and how they signed in.
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    if (user === undefined)
      return c.json({ error: { code: "unauthorized", message: "Sign in." } }, 401);
    c.set("user", { userId: user, isAdmin: c.req.header("x-admin") === "1" });
    c.set("sessionVia", c.req.header("x-via") ?? "password");
    await next();
  });
  app.route(PREFIX, routes);
  app.route("/api/rsi-workbench/ui", uiRoutes(options.uiDir ?? path.join(root, "ui")));

  const firstOwner = Object.values(projects)[0]?.owner ?? "alice";
  const host: TestHost = {
    root,
    app,
    projects,
    started,
    benchmarksDir,
    setStatus(sessionId, status) {
      statuses.set(sessionId, status);
    },
    async request(method, url, as = {}, body) {
      const headers: Record<string, string> = { "x-user": as.user ?? firstOwner };
      if (as.admin === true) headers["x-admin"] = "1";
      if (as.via !== undefined) headers["x-via"] = as.via;
      if (body !== undefined) headers["content-type"] = "application/json";
      return app.request(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    async dispose() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
  return host;
}

/** Whether this machine can create symbolic links (Windows needs a privilege or Developer Mode). */
export async function canCreateSymlink(): Promise<boolean> {
  const dir = await tempRoot("rsi-symlink-probe-");
  try {
    await fs.symlink(dir, path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
