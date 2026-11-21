/**
 * The Use dialog: the two models it picks apart, the Optimize tab's baseline, and what a toolkit
 * other than the default asks for.
 *
 * - Given a tested agent whose latest evaluation here ran on another model than the Project's
 *   default, the tested model presets to that model while the conversation keeps the default:
 *   Start sends both, apart.
 * - Given a last-evaluated model the Project no longer lists, the tested model is the default.
 * - Given the default loop, the baseline is the tested agent's score on the tested model, and a
 *   tested model with no score there shows the no-baseline notice.
 * - Given a toolkit other than the default, the tab asks for test-set repetitions (3) in place of
 *   runs per case and sends them with the toolkit as the method; repetitions out of range are
 *   refused under the field and keep Start shut.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MergedEvaluation } from "../../src/api";
import { formatScore } from "../../src/ui/format";
import { zh } from "../../src/ui/strings";
import {
  FakeServer,
  benchmark,
  button,
  cardButton,
  click,
  evaluation,
  fakeHost,
  field,
  hasField,
  mountApp,
  pick,
  serveProject,
  shows,
  type,
  unmountAll,
  waitFor,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TASKS = "/api/projects/proj/benchmarks/tasks";

async function openUse(evaluations: MergedEvaluation[], tab: "evaluate" | "optimize" = "evaluate") {
  const server = serveProject(new FakeServer(), {
    benchmarks: [benchmark({ title: "Ticket resolution", evaluations })],
  }).install();
  fakeHost();
  await mountApp();
  await waitFor(() => shows("Ticket resolution"), "the list");
  await click(cardButton("Ticket resolution", zh.benchmark.use));
  if (tab === "optimize") await click(button(zh.benchmark.optimize));
  return server;
}

const startBody = async (server: FakeServer) => {
  await click(button(zh.form.start));
  await waitFor(
    () => server.seen("POST", TASKS).some((r) => r.query.get("preview") !== "1"),
    "the start",
  );
  return server.seen("POST", TASKS).find((r) => r.query.get("preview") !== "1")!.body;
};

describe("the tested agent's model", () => {
  it("presets to the model of the agent's latest evaluation and keeps the conversation on the default", async () => {
    const server = await openUse([evaluation({ modelId: "m-b", score: 70 })]);

    expect(field(zh.benchmark.testedModel).textContent).toContain("m-b");
    expect(field(zh.benchmark.evaluateSessionModel).textContent).toContain("m-a");
    expect(await startBody(server)).toMatchObject({
      kind: "evaluate",
      benchmarkId: "sec-a",
      agentId: "default_agent",
      targetAgentId: "ticket-agent",
      testedModel: { provider: "custom", modelId: "m-b" },
      model: { provider: "custom", modelId: "m-a" },
      runs: 1,
      approvalMode: "allow-all",
      language: "zh",
    });
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

  it("asks a toolkit for test-set repetitions and sends them with the toolkit", async () => {
    const server = await openUse([evaluation({ modelId: "m-b" })], "optimize");

    await pick(zh.benchmark.methodField, "SkillOpt");
    expect(hasField(zh.benchmark.runsField)).toBe(false);
    expect(field(zh.benchmark.testRepetitionsField).value).toBe("3");
    await type(field(zh.benchmark.testRepetitionsField), "5");

    const body = await startBody(server);
    expect(body).toMatchObject({
      kind: "optimize",
      method: "skillopt-rsi-toolkit",
      testRepetitions: 5,
      testedModel: { provider: "custom", modelId: "m-b" },
    });
    expect(body).not.toHaveProperty("runs");
    expect(body).not.toHaveProperty("roundLimit");
  });

  it("refuses test-set repetitions out of range", async () => {
    await openUse([], "optimize");
    await pick(zh.benchmark.methodField, "SkillOpt");

    await type(field(zh.benchmark.testRepetitionsField), "0");

    expect(shows(zh.benchmark.invalidRuns)).toBe(true);
    expect(button(zh.form.start).disabled).toBe(true);
  });
});
