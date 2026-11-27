/**
 * The Use dialog: the two models it picks apart, the Optimize tab's baseline, and what a toolkit
 * other than the default asks for and needs.
 *
 * - Given a tested agent whose latest evaluation here ran on another model than the Project's
 *   default, the tested model presets to that model while the conversation keeps the default:
 *   Start asks the prompt for the tested model and opens the conversation on the other, with the
 *   evaluation Skill preselected, and records an evaluate task on the Benchmark.
 * - Given a last-evaluated model the Project no longer lists, the tested model is the default.
 * - Given the default loop, the baseline is the tested agent's score on the tested model, and a
 *   tested model with no score there shows the no-baseline notice.
 * - Given a toolkit other than the default, the tab asks for test-set repetitions (3) in place of
 *   runs per case and sends them with the toolkit as the method, its Skill preselected;
 *   repetitions out of range are refused under the field and keep Start shut.
 * - Given an optimizer without the toolkit's Skill, the tab says so before Start; Start then offers
 *   to install that toolkit, and goes through once it is installed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MergedEvaluation } from "../../src/api";
import { formatScore } from "../../src/ui/format";
import { zh } from "../../src/ui/strings";
import {
  FakeServer,
  NEW_SESSION,
  agentPath,
  benchmark,
  button,
  cardButton,
  click,
  evaluation,
  field,
  hasField,
  messageText,
  mountApp,
  pick,
  pressStart,
  promptText,
  serveProject,
  shows,
  startedTask,
  type,
  unmountAll,
  waitFor,
  type ProjectFixture,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openUse(
  evaluations: MergedEvaluation[],
  tab: "evaluate" | "optimize" = "evaluate",
  fixture: ProjectFixture = {},
) {
  const server = serveProject(new FakeServer(), {
    benchmarks: [benchmark({ title: "Ticket resolution", evaluations })],
    ...fixture,
  }).install();
  await mountApp();
  await waitFor(() => shows("Ticket resolution"), "the list");
  await click(cardButton("Ticket resolution", zh.benchmark.use));
  if (tab === "optimize") await click(button(zh.benchmark.optimize));
  return server;
}

describe("the tested agent's model", () => {
  it("presets to the model of the agent's latest evaluation and keeps the conversation on the default", async () => {
    const server = await openUse([evaluation({ modelId: "m-b", score: 70 })]);

    expect(field(zh.benchmark.testedModel).textContent).toContain("m-b");
    expect(field(zh.benchmark.evaluateSessionModel).textContent).toContain("m-a");
    const calls = await startedTask(server, await pressStart(server));

    expect(calls.prompt.body).toEqual({
      kind: "evaluate",
      benchmarkId: "sec-a",
      targetAgentId: "ticket-agent",
      testedModel: { provider: "custom", modelId: "m-b" },
      runs: 1,
      language: "zh",
    });
    expect(calls.session.path).toBe(`${agentPath("default_agent")}/sessions`);
    expect(calls.session.body).toEqual({
      approvalMode: "allow-all",
      provider: "custom",
      modelId: "m-a",
    });
    expect(messageText(calls.message)).toBe(
      `[use_skills]\nskills: agent-evaluation\n[/use_skills]\n\n${promptText("evaluate")}`,
    );
    expect(calls.record.body).toEqual({
      sessionId: NEW_SESSION,
      kind: "evaluate",
      benchmarkId: "sec-a",
      agentId: "default_agent",
      approvalMode: "allow-all",
    });
  });

  it("opens the conversation on the model picked for it, apart from the tested one", async () => {
    const server = await openUse([evaluation({ modelId: "m-b" })]);

    await pick(zh.benchmark.evaluateSessionModel, "m-c · custom");
    const calls = await startedTask(server, await pressStart(server));

    expect(calls.session.body).toMatchObject({ modelId: "m-c" });
    expect(calls.prompt.body).toMatchObject({ testedModel: { modelId: "m-b" } });
  });

  it("falls back to the Project's default when the last-evaluated model is no longer listed", async () => {
    await openUse([evaluation({ modelId: "m-gone" })]);

    expect(field(zh.benchmark.testedModel).textContent).toContain("m-a");
  });
});

describe("the Optimize tab", () => {
  it("reads the default loop's baseline on the tested model", async () => {
    await openUse(
      [evaluation({ modelId: "m-a", score: 40 }), evaluation({ modelId: "m-b", score: 70 })],
      "optimize",
    );

    expect(shows(zh.benchmark.baselineLine(formatScore(70), 80))).toBe(true);
    await pick(zh.benchmark.testedModel, "m-a · custom");
    expect(shows(zh.benchmark.baselineLine(formatScore(40), 50))).toBe(true);
    await pick(zh.benchmark.testedModel, "m-c · custom");
    expect(shows(zh.benchmark.noBaseline)).toBe(true);
  });

  it("asks a toolkit for test-set repetitions and sends them with the toolkit, its Skill preselected", async () => {
    const server = await openUse([evaluation({ modelId: "m-b" })], "optimize");

    await pick(zh.benchmark.methodField, "SkillOpt");
    expect(hasField(zh.benchmark.runsField)).toBe(false);
    expect(field(zh.benchmark.testRepetitionsField).value).toBe("3");
    await type(field(zh.benchmark.testRepetitionsField), "5");

    const calls = await startedTask(server, await pressStart(server));
    expect(calls.prompt.body).toMatchObject({
      kind: "optimize",
      method: "skillopt-rsi-toolkit",
      skill: "skillopt-rsi-toolkit",
      testRepetitions: 5,
      testedModel: { provider: "custom", modelId: "m-b" },
    });
    expect(calls.prompt.body).not.toHaveProperty("runs");
    expect(calls.prompt.body).not.toHaveProperty("roundLimit");
    expect(messageText(calls.message)).toBe(
      `[use_skills]\nskills: skillopt-rsi-toolkit\n[/use_skills]\n\n${promptText("optimize")}`,
    );
    expect(calls.record.body).toMatchObject({ kind: "optimize", benchmarkId: "sec-a" });
  });

  it("refuses test-set repetitions out of range", async () => {
    await openUse([], "optimize");
    await pick(zh.benchmark.methodField, "SkillOpt");

    await type(field(zh.benchmark.testRepetitionsField), "0");

    expect(shows(zh.benchmark.invalidRuns)).toBe(true);
    expect(button(zh.form.start).disabled).toBe(true);
  });

  it("offers to install the toolkit an optimizer lacks, and starts once it is installed", async () => {
    const server = await openUse([evaluation({ modelId: "m-b" })], "optimize", {
      skills: { default_agent: ["agent-evaluation", "benchmark-design", "agent-optimization"] },
    });
    await pick(zh.benchmark.methodField, "SkillOpt");
    await waitFor(
      () => shows(zh.benchmark.methodMissingSkill("skillopt-rsi-toolkit", "skillopt-rsi-toolkit")),
      "the warning before Start",
    );

    await pressStart(server);
    await waitFor(
      () => shows(zh.tasks.skillMissing("skillopt-rsi-toolkit", "skillopt-rsi-toolkit")),
      "the notice",
    );
    expect(server.requests.filter((r) => r.path.endsWith("/sessions"))).toEqual([]);
    await click(button(zh.tasks.install));
    await waitFor(() => shows(zh.tasks.installed("skillopt-rsi-toolkit")), "the installed note");

    expect(server.seen("POST", `${agentPath("default_agent")}/plugins`).map((r) => r.body)).toEqual(
      [{ names: ["skillopt-rsi-toolkit"] }],
    );
    const calls = await startedTask(server, await pressStart(server));
    expect(messageText(calls.message)).toContain("skills: skillopt-rsi-toolkit");
  });
});
