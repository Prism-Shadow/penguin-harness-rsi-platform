/**
 * Agent tasks the workbench starts (POST / GET …/benchmarks/tasks).
 *
 * Given a Project with a Benchmark on this server and Agents with and without the workbench's
 * Skills:
 * - When a member presses Start on a form, the server builds the request the page used to
 *   prefill, starts it as that person's conversation on the chosen Agent with the approval mode
 *   the form chose (allow-all when it chose none), preselects the Skills the Agent has, and
 *   records the task; the answer carries the conversation and its state.
 * - When the Agent lacks a Skill the task cannot do without, nothing starts and the answer
 *   names the Skill and the plugin that ships it.
 * - When the request comes with the local API token, nothing starts.
 * - When the form asks for a preview, the prompt comes back in the page's language and nothing
 *   starts.
 * - When the page lists tasks, each shows where its conversation stands, newest first, filtered
 *   by Benchmark; a conversation the viewer cannot open is not listed to them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyToml } from "smol-toml";
import type {
  TaskPreviewResponse,
  TaskStartResponse,
  TasksResponse,
  WorkbenchTaskRequest,
} from "../../src/api.js";
import { createTestHost, type TestHost } from "../helpers/host.js";

const TASKS = "/api/projects/p1/benchmarks/tasks";

async function writeBenchmark(host: TestHost, id: string, runs = 2): Promise<string> {
  const dir = path.join(host.benchmarksDir("p1"), id);
  await fs.mkdir(path.join(dir, "CASE-001-a", "statement"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "benchmark_config.toml"),
    stringifyToml({ id, title: id, status: "published", runs, origin: { kind: "agent" } }),
  );
  await fs.writeFile(path.join(dir, "CASE-001-a", "statement", "README.md"), "# A\n");
  return dir;
}

const evaluate = (over: Partial<WorkbenchTaskRequest> = {}): WorkbenchTaskRequest =>
  ({
    kind: "evaluate",
    agentId: "default_agent",
    benchmarkId: "sec-a",
    targetAgentId: "writer",
    runs: 2,
    testedModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    notes: "Watch the citation cases.",
    ...over,
  }) as WorkbenchTaskRequest;

describe("workbench tasks", () => {
  let host: TestHost;
  let benchDir: string;

  beforeEach(async () => {
    host = await createTestHost({
      library: [
        {
          name: "default-rsi-toolkit",
          category: "rsi",
          title: "Default RSI Toolkit",
          skills: [{ name: "agent-optimization" }],
        },
        {
          name: "opro-rsi-toolkit",
          category: "rsi",
          title: "OPRO",
          skills: [{ name: "opro-rsi-toolkit" }],
        },
      ],
    });
    benchDir = await writeBenchmark(host, "sec-a");
  });
  afterEach(async () => {
    await host.dispose();
  });

  it("starts an evaluation as the member's own conversation, allow-all unless the form says otherwise", async () => {
    const res = await host.request("POST", TASKS, { user: "bob" }, evaluate());
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as TaskStartResponse;
    expect(task).toMatchObject({
      kind: "evaluate",
      benchmarkId: "sec-a",
      agentId: "default_agent",
      userId: "bob",
      approvalMode: "allow-all",
      state: "running",
    });
    expect(host.started).toHaveLength(1);
    const [started] = host.started;
    expect(started).toMatchObject({
      userId: "bob",
      projectId: "p1",
      agentId: "default_agent",
      approvalMode: "allow-all",
      skills: ["agent-evaluation"],
      sessionId: task.sessionId,
    });
    // The person's note first, then the tail naming the Skill, the Benchmark's folder and the model.
    expect(
      started!.prompt.startsWith("Watch the citation cases.\n\nUse the `agent-evaluation` Skill"),
    ).toBe(true);
    expect(started!.prompt).toContain(`- BENCHMARK_DIR: \`${benchDir}\``);
    expect(started!.prompt).toContain("- test_agent_id: `writer`");
    expect(started!.prompt).toContain("- model_id: `deepseek-v4-pro`");
  });

  it("keeps the approval mode and the conversation model the form chose", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      evaluate({
        approvalMode: "always-ask",
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      }),
    );
    expect(res.status).toBe(201);
    expect(host.started[0]).toMatchObject({
      approvalMode: "always-ask",
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
    });
  });

  it("refuses a task the Agent lacks a needed Skill for, naming the plugin, and starts nothing", async () => {
    const res = await host.request("POST", TASKS, {}, evaluate({ agentId: "writer" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details: Record<string, string> } };
    expect(body.error.code).toBe("skill_missing");
    expect(body.error.details).toEqual({
      agentId: "writer",
      skill: "agent-evaluation",
      plugin: "rsi-workbench",
    });
    expect(host.started).toHaveLength(0);
  });

  it("starts once the Skill is installed on the Agent", async () => {
    expect((await host.request("POST", TASKS, {}, evaluate({ agentId: "writer" }))).status).toBe(
      409,
    );
    host.projects.p1!.agents!.find((a) => a.agentId === "writer")!.skills = ["agent-evaluation"];
    expect((await host.request("POST", TASKS, {}, evaluate({ agentId: "writer" }))).status).toBe(
      201,
    );
  });

  it("names the toolkit that ships a paper method's Skill when the optimizer lacks it", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "optimize",
        agentId: "default_agent",
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "opro-rsi-toolkit",
        testedModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        testRepetitions: 3,
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { details: Record<string, string> } };
    expect(body.error.details).toMatchObject({
      skill: "opro-rsi-toolkit",
      plugin: "opro-rsi-toolkit",
    });
  });

  it("refuses the local API token, so an Agent's shell cannot start a task in a person's name", async () => {
    const res = await host.request("POST", TASKS, { via: "token" }, evaluate());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("human_required");
    expect(host.started).toHaveLength(0);
  });

  it("refuses an outsider and a system Agent", async () => {
    expect((await host.request("POST", TASKS, { user: "mallory" }, evaluate())).status).toBe(404);
    const system = await host.request("POST", TASKS, {}, evaluate({ agentId: "system_agent" }));
    expect(system.status).toBe(409);
    expect(((await system.json()) as { error: { code: string } }).error.code).toBe(
      "system_agent_no_sessions",
    );
    expect(host.started).toHaveLength(0);
  });

  it("previews the request in the page's language without starting anything, even from the token", async () => {
    const res = await host.request(
      "POST",
      `${TASKS}?preview=1`,
      { via: "token" },
      evaluate({ language: "zh", agentId: "writer" }),
    );
    expect(res.status).toBe(200);
    const preview = (await res.json()) as TaskPreviewResponse;
    expect(preview.prompt).toContain("请使用 `agent-evaluation` Skill");
    expect(preview.skills).toEqual(["agent-evaluation"]);
    expect(host.started).toHaveLength(0);
  });

  it("writes a create request for the Test Agent into the Project's Benchmark folder", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "create",
        agentId: "default_agent",
        targetAgentId: "writer",
        notes: "Test report writing under contradicting sources.",
      },
    );
    expect(res.status).toBe(201);
    const started = host.started[0]!;
    expect(started.skills).toEqual(["benchmark-design", "agent-evaluation"]);
    expect(started.prompt).toContain(
      `BENCHMARK_DIR is \`${host.benchmarksDir("p1")}/<benchmark_id>/\``,
    );
    expect(started.prompt.startsWith("Test report writing under contradicting sources.")).toBe(
      true,
    );
  });

  it("imports with the design Skill only when the Agent has it, and needs none", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "import",
        agentId: "writer",
        source: "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/x",
      },
    );
    expect(res.status).toBe(201);
    const started = host.started[0]!;
    expect(started.skills).toEqual([]);
    expect(started.prompt).toMatch(/^Import the Benchmark package at this repository folder/);
  });

  it("runs the default loop with its round limit and target score, preselecting optimizer and evaluator", async () => {
    host.projects
      .p1!.agents!.find((a) => a.agentId === "default_agent")!
      .skills!.push("agent-optimization");
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "optimize",
        agentId: "default_agent",
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "default-rsi-toolkit",
        testedModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        roundLimit: 5,
        targetScore: 80,
      },
    );
    expect(res.status).toBe(201);
    const started = host.started[0]!;
    expect(started.skills).toEqual(["agent-optimization", "agent-evaluation"]);
    // Runs default to the Benchmark's own count.
    expect(started.prompt).toContain("- runs: `2`");
    expect(started.prompt).toContain("- desired_score: `>=80`");
    expect(started.prompt).toContain("- candidate_round_limit: `5`");
  });

  it("refuses a method the library does not offer", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "optimize",
        agentId: "default_agent",
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "nonexistent-rsi-toolkit",
        testedModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("method_unknown");
  });

  it("asks about a case with no Skill, reading the files it names", async () => {
    const res = await host.request(
      "POST",
      TASKS,
      {},
      {
        kind: "ask",
        agentId: "writer",
        benchmarkId: "sec-a",
        question: "What does this case test?",
        case: { caseId: "CASE-001-a", latest: null },
      },
    );
    expect(res.status).toBe(201);
    const started = host.started[0]!;
    expect(started.skills).toEqual([]);
    expect(started.prompt).toContain(`- Statement: \`${benchDir}/CASE-001-a/statement/README.md\``);
    expect(started.prompt).toContain("This Benchmark has no evaluations yet.");
  });

  it("refuses a request out of shape before anything starts", async () => {
    for (const body of [
      { ...evaluate(), kind: "rewrite" },
      { ...evaluate(), approvalMode: "yolo" },
      { ...evaluate(), runs: 0 },
      { ...evaluate(), benchmarkId: "../escape" },
      { kind: "ask", agentId: "writer", benchmarkId: "sec-a", question: "?" },
    ]) {
      expect((await host.request("POST", TASKS, {}, body)).status).toBe(400);
    }
    expect(host.started).toHaveLength(0);
  });

  it("lists the tasks started on a Benchmark, newest first, with where each stands", async () => {
    const first = (
      (await (await host.request("POST", TASKS, {}, evaluate())).json()) as TaskStartResponse
    ).task;
    const second = (
      (await (
        await host.request(
          "POST",
          TASKS,
          {},
          {
            kind: "import",
            agentId: "default_agent",
            source: "/tmp/package",
          },
        )
      ).json()) as TaskStartResponse
    ).task;
    const third = (
      (await (
        await host.request("POST", TASKS, {}, evaluate({ runs: 1 }))
      ).json()) as TaskStartResponse
    ).task;
    host.setStatus(first.sessionId, {
      status: "idle",
      title: "Evaluate sec-a",
      pendingApprovals: 0,
    });
    host.setStatus(third.sessionId, { status: "running", title: null, pendingApprovals: 2 });

    const listed = (await (
      await host.request("GET", `${TASKS}?benchmarkId=sec-a`)
    ).json()) as TasksResponse;
    expect(listed.tasks.map((t) => [t.sessionId, t.state])).toEqual([
      [third.sessionId, "waiting"],
      [first.sessionId, "done"],
    ]);
    expect(listed.tasks[1]!.title).toBe("Evaluate sec-a");

    const all = (await (await host.request("GET", TASKS)).json()) as TasksResponse;
    expect(all.tasks.map((t) => t.sessionId)).toEqual([
      third.sessionId,
      second.sessionId,
      first.sessionId,
    ]);
  });

  it("does not list a task whose conversation the viewer cannot open, nor one that is gone", async () => {
    const mine = (
      (await (
        await host.request("POST", TASKS, { user: "bob" }, evaluate())
      ).json()) as TaskStartResponse
    ).task;
    const theirs = (
      (await (await host.request("POST", TASKS, {}, evaluate())).json()) as TaskStartResponse
    ).task;
    const asBob = (await (
      await host.request("GET", TASKS, { user: "bob" })
    ).json()) as TasksResponse;
    expect(asBob.tasks.map((t) => t.sessionId)).toEqual([mine.sessionId]);
    host.setStatus(theirs.sessionId, null);
    const asAlice = (await (await host.request("GET", TASKS)).json()) as TasksResponse;
    expect(asAlice.tasks).toEqual([]);
  });

  it("keeps the records in the app's state folder, one line each, and skips a torn line", async () => {
    await host.request("POST", TASKS, {}, evaluate());
    const file = path.join(
      host.root,
      "projects/p1/agents/system_agent/app/state/benchmark/tasks.jsonl",
    );
    await fs.appendFile(file, '{"sessionId": "torn');
    await host.request("POST", TASKS, {}, evaluate());
    const listed = (await (await host.request("GET", TASKS)).json()) as TasksResponse;
    expect(listed.tasks).toHaveLength(2);
  });
});
