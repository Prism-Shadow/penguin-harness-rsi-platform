/**
 * An admin's list reads every machine's copies (GET …/benchmarks, GET …/:id/cases).
 *
 * Given this server and two machines, one connected and one not, holding copies of the same
 * Benchmark and Benchmarks of their own:
 * - an admin's list is one entry per Benchmark id, this server's description first, the copies'
 *   evaluations joined in time order with the machine each was read from, and the machines that
 *   could not be read named as unreachable;
 * - an admin's case list is the union of the copies' cases, this server's winning a shared id,
 *   each case recorded against the server its files are read from;
 * - a member who is not an admin sees this server's copies alone, in the same shape;
 * - `?local=1`, what a hub asks a machine, answers that server's own list in the old shape and
 *   never asks further, so two servers never ask each other in a loop.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import type {
  BenchmarksResponse,
  WorkbenchBenchmarksResponse,
  WorkbenchCasesResponse,
} from "../../src/api.js";
import { createTestHost, type TestHost } from "../helpers/host.js";

const LIST = "/api/projects/p1/benchmarks";

function evaluation(time: string, score: number) {
  return {
    time,
    agent_id: "default_agent",
    version: 1,
    provider: "deepseek",
    model_id: "deepseek-v4-pro",
    thinking_level: "medium",
    score,
    cost: null,
    duration_ms: 1000,
    cases: [
      {
        case: "CASE-001-a",
        score,
        cost: null,
        duration_ms: 1000,
        runs: [{ score, cost: null, duration_ms: 1000, session_id: `s-${time}` }],
      },
    ],
  };
}

async function writeCopy(
  host: TestHost,
  id: string,
  options: { title: string; version?: string; cases: string[]; evaluations?: unknown[] },
) {
  const dir = path.join(host.benchmarksDir("p1"), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "benchmark_config.toml"),
    stringifyToml({
      id,
      title: options.title,
      status: "published",
      ...(options.version !== undefined ? { version: options.version } : {}),
    }),
  );
  await fs.writeFile(
    path.join(dir, "scoreboard.yaml"),
    stringifyYaml({ evaluations: options.evaluations ?? [] }),
  );
  for (const caseId of options.cases) {
    await fs.mkdir(path.join(dir, caseId, "statement"), { recursive: true });
    await fs.writeFile(
      path.join(dir, caseId, "statement", "README.md"),
      `# ${caseId} on ${options.title}\n`,
    );
  }
}

describe("benchmarks across machines", () => {
  let hub: TestHost;
  let machine: TestHost;

  beforeEach(async () => {
    machine = await createTestHost();
    hub = await createTestHost({ machines: { m1: machine, gone: null } });
    await writeCopy(hub, "shared", {
      title: "Shared here",
      cases: ["CASE-001-a", "CASE-002-b"],
      evaluations: [evaluation("2026-11-02T00:00:00Z", 60)],
    });
    await writeCopy(machine, "shared", {
      title: "Shared there",
      version: "2026.11.01.1",
      cases: ["CASE-002-b", "CASE-003-c"],
      evaluations: [evaluation("2026-11-01T00:00:00Z", 40), evaluation("2026-11-03T00:00:00Z", 70)],
    });
    await writeCopy(machine, "machine-only", { title: "Only there", cases: ["CASE-001-a"] });
  });
  afterEach(async () => {
    await hub.dispose();
    await machine.dispose();
  });

  it("merges an admin's list by id, this server's description first, evaluations in time order", async () => {
    const res = (await (
      await hub.request("GET", LIST, { admin: true })
    ).json()) as WorkbenchBenchmarksResponse;
    expect(res.unreachable).toEqual(["gone"]);
    expect(res.dir).toBe(hub.benchmarksDir("p1"));
    const [shared, only] = res.benchmarks;
    expect(shared).toMatchObject({
      id: "shared",
      title: "Shared here",
      dir: path.join(hub.benchmarksDir("p1"), "shared"),
      // This copy has no version, so the next copy that names one supplies it.
      version: "2026.11.01.1",
      machineIds: [null, "m1"],
      caseCount: 2,
    });
    expect(shared!.evaluations.map((e) => [e.time, e.machineId])).toEqual([
      ["2026-11-01T00:00:00Z", "m1"],
      ["2026-11-02T00:00:00Z", null],
      ["2026-11-03T00:00:00Z", "m1"],
    ]);
    expect(only).toMatchObject({ id: "machine-only", machineIds: ["m1"] });
  });

  it("joins an admin's case lists, this server's copy winning a shared case", async () => {
    const res = (await (
      await hub.request("GET", `${LIST}/shared/cases`, { admin: true })
    ).json()) as WorkbenchCasesResponse;
    expect(res.cases).toEqual([
      { id: "CASE-001-a", title: "CASE-001-a on Shared here", machineId: null },
      { id: "CASE-002-b", title: "CASE-002-b on Shared here", machineId: null },
      { id: "CASE-003-c", title: "CASE-003-c on Shared there", machineId: "m1" },
    ]);
  });

  it("shows a member who is not an admin this server's copies alone", async () => {
    const res = (await (
      await hub.request("GET", LIST, { user: "bob" })
    ).json()) as WorkbenchBenchmarksResponse;
    expect(res.unreachable).toBeUndefined();
    expect(res.benchmarks.map((b) => [b.id, b.machineIds])).toEqual([["shared", [null]]]);
    expect(res.benchmarks[0]!.evaluations.map((e) => e.machineId)).toEqual([null]);
    const cases = (await (
      await hub.request("GET", `${LIST}/shared/cases`, { user: "bob" })
    ).json()) as WorkbenchCasesResponse;
    expect(cases.cases.map((c) => c.machineId)).toEqual([null, null]);
  });

  it("answers a hub's local read in the old shape without asking any machine", async () => {
    const res = (await (
      await hub.request("GET", `${LIST}?local=1`, { admin: true })
    ).json()) as BenchmarksResponse & { unreachable?: unknown };
    expect(res.unreachable).toBeUndefined();
    expect(res.benchmarks.map((b) => b.id)).toEqual(["shared"]);
    expect("machineIds" in res.benchmarks[0]!).toBe(false);
  });
});
