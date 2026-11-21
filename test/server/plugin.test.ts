/**
 * The package as the host loads it: its default export and the app module's wiring.
 *
 * Given the host's interfaces as the module declares them:
 * - the default export is a plugin of the library component and the app component;
 * - the app reads and writes the Benchmarks in the data folder the host's AppData names for app
 *   `benchmark`, and keeps its task records in that app's state folder;
 * - the `benchmark` id kind's code half lists every id a new Benchmark may not take, a leftover
 *   folder with no manifest included.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { stringify as stringifyToml } from "smol-toml";
import plugin, { RsiWorkbenchApp, RsiWorkbenchLibrary } from "../../src/index.js";
import type { RouteEnv } from "../../src/server/routes.js";
import type { BenchmarksResponse, TaskStartResponse } from "../../src/api.js";
import { FakeCaseFiles, PREFIX, appDataPaths, tempRoot } from "../helpers/host.js";

describe("the plugin package", () => {
  let root: string;
  let app: RsiWorkbenchApp;
  let http: Hono<RouteEnv>;

  beforeEach(async () => {
    root = await tempRoot();
    app = new RsiWorkbenchApp();
    // The fields the host injects before setup(), each one of the module's declared views.
    Object.assign(app, {
      appData: {
        dataPaths: async (projectId: string, appId: string) => appDataPaths(root, projectId, appId),
      },
      access: {
        requireProjectAccess: () => ({ role: "owner" as const }),
        requireProjectOwner: () => undefined,
      },
      agents: { listAgents: async () => [{ agentId: "default_agent" }] },
      skills: { installedSkills: async () => ["agent-evaluation", "benchmark-design"] },
      models: { getModels: async () => ({ models: [] }) },
      library: { list: () => [] },
      machines: { projectApis: async () => [] },
      files: new FakeCaseFiles(),
      tasks: {
        start: async () => ({ sessionId: "session-1" }),
        status: async () => ({ status: "running", pendingApprovals: 0 }),
      },
    });
    app.setup();
    http = new Hono<RouteEnv>();
    http.use("*", async (c, next) => {
      c.set("user", { userId: "alice", isAdmin: false });
      c.set("sessionVia", "password");
      await next();
    });
    http.route(PREFIX, app.routes);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exports the library component and the app component as its modules", () => {
    expect(plugin.modules).toEqual([RsiWorkbenchLibrary, RsiWorkbenchApp]);
  });

  it("reads the Benchmarks in the data folder AppData names, and records tasks in its state folder", async () => {
    const { dataDir, stateDir } = appDataPaths(root, "p1", "benchmark");
    await fs.mkdir(path.join(dataDir, "sec-a"), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "sec-a", "benchmark_config.toml"),
      stringifyToml({ id: "sec-a", title: "Sec A", status: "published" }),
    );
    const listed = (await (
      await http.request("/api/projects/p1/benchmarks")
    ).json()) as BenchmarksResponse;
    expect(listed.dir).toBe(dataDir);
    expect(listed.benchmarks.map((b) => b.id)).toEqual(["sec-a"]);

    const res = await http.request("/api/projects/p1/benchmarks/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "ask",
        agentId: "default_agent",
        benchmarkId: "sec-a",
        question: "What does it test?",
        case: { caseId: "CASE-001-a", latest: null },
      }),
    });
    expect(((await res.json()) as TaskStartResponse).task.sessionId).toBe("session-1");
    const lines = (await fs.readFile(path.join(stateDir, "tasks.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(lines.map((line) => JSON.parse(line).sessionId)).toEqual(["session-1"]);
  });

  it("names every taken Benchmark id to the id kind, a leftover folder included", async () => {
    const { dataDir } = appDataPaths(root, "p1", "benchmark");
    expect(await app.benchmarkIds.takenIds("p1")).toEqual([]);
    await fs.mkdir(path.join(dataDir, "leftover"), { recursive: true });
    expect(await app.benchmarkIds.takenIds("p1")).toEqual(["leftover"]);
  });
});
