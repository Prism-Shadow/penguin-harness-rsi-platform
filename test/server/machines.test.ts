/**
 * An admin's reads of every machine's copies, one machine per request (GET …/benchmarks?machine=,
 * GET …/:id/cases?machine=), merged by the page as each answer lands.
 *
 * Given this server and two machines, one connected and one not, holding copies of the same
 * Benchmark and Benchmarks of their own:
 * - the plain list and case list are this server's alone, for an admin too, so they never wait on
 *   a machine;
 * - `?machine=<id>` answers that machine's own list or cases, asked with `?local=1`, for an admin
 *   only; a machine the Project does not use is a 404, one that gives no answer a 502 naming it;
 * - merged, the answers are one entry per Benchmark id, this server's description first, the
 *   copies' evaluations joined in time order with the machine each was read from, and the case
 *   lists' union, this server's winning a shared case.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import type { BenchmarkCasesResponse, BenchmarksResponse } from "../../src/api.js";
import { mergeBenchmarkCases, mergeBenchmarks } from "../../src/merge.js";
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

  const read = async <T>(url: string, as: { admin?: boolean; user?: string } = { admin: true }) =>
    (await (await hub.request("GET", url, as)).json()) as T;

  it("answers this server's list and cases alone, for an admin too", async () => {
    const list = await read<BenchmarksResponse & { unreachable?: unknown }>(LIST);
    expect(list.dir).toBe(hub.benchmarksDir("p1"));
    expect(list.unreachable).toBeUndefined();
    expect(list.benchmarks.map((b) => b.id)).toEqual(["shared"]);
    expect("machineIds" in list.benchmarks[0]!).toBe(false);
    expect((await read<BenchmarksResponse>(`${LIST}?local=1`)).benchmarks).toEqual(list.benchmarks);
    const cases = await read<BenchmarkCasesResponse>(`${LIST}/shared/cases`);
    expect(cases.cases.map((c) => c.id)).toEqual(["CASE-001-a", "CASE-002-b"]);
  });

  it("answers one machine's list and cases for an admin, refusing a member, an unknown and a silent machine", async () => {
    const there = await read<BenchmarksResponse>(`${LIST}?machine=m1`);
    expect(there.benchmarks.map((b) => b.id)).toEqual(["machine-only", "shared"]);
    const cases = await read<BenchmarkCasesResponse>(`${LIST}/shared/cases?machine=m1`);
    expect(cases.cases.map((c) => c.id)).toEqual(["CASE-002-b", "CASE-003-c"]);

    const member = await hub.request("GET", `${LIST}?machine=m1`, { user: "bob" });
    expect(member.status).toBe(403);
    expect(((await member.json()) as { error: { code: string } }).error.code).toBe(
      "admin_required",
    );
    expect((await hub.request("GET", `${LIST}?machine=nope`, { admin: true })).status).toBe(404);
    const silent = await hub.request("GET", `${LIST}/shared/cases?machine=gone`, { admin: true });
    expect(silent.status).toBe(502);
    expect(await silent.json()).toMatchObject({
      error: { code: "machine_unreachable", details: { machineId: "gone" } },
    });
  });

  it("merges the answers by id, this server's description first, evaluations in time order", async () => {
    const [here, there] = await Promise.all([
      read<BenchmarksResponse>(LIST),
      read<BenchmarksResponse>(`${LIST}?machine=m1`),
    ]);
    const [shared, only] = mergeBenchmarks([
      { machineId: null, benchmarks: here.benchmarks },
      { machineId: "m1", benchmarks: there.benchmarks },
    ]);
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

    const [hereCases, thereCases] = await Promise.all([
      read<BenchmarkCasesResponse>(`${LIST}/shared/cases`),
      read<BenchmarkCasesResponse>(`${LIST}/shared/cases?machine=m1`),
    ]);
    expect(
      mergeBenchmarkCases([
        { machineId: null, cases: hereCases.cases },
        { machineId: "m1", cases: thereCases.cases },
      ]),
    ).toEqual([
      { id: "CASE-001-a", title: "CASE-001-a on Shared here", machineId: null },
      { id: "CASE-002-b", title: "CASE-002-b on Shared here", machineId: null },
      { id: "CASE-003-c", title: "CASE-003-c on Shared there", machineId: "m1" },
    ]);
  });
});
