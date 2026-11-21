/**
 * How the page reads a scoreboard: scores, the chart's axis, series by label, the cards' latest
 * score and its change, the Optimize tab's baseline and target, and the search box.
 *
 * - Given stored Scores, the chart reads them as they are and a malformed one as missing; its axis
 *   pads the observed range, clamps it to 0..100 and rounds it outward to friendly ticks.
 * - Given evaluations, a series is one tested Agent on one model at one thinking level: a new Agent
 *   State version or another provider of the same model continues it, a record missing the Agent
 *   or the model falls into one unlabeled series, and each series' line runs through its own
 *   points at their places on the shared axis.
 * - Given a newest Score, its change is measured against the previous Score of the same label only.
 * - Given a baseline, the default target is ten points above it, capped at 100, and 80 without one.
 * - Given a search, a Benchmark matches on its titles, description, id, and its tested Agents' ids
 *   or names.
 */
import { describe, expect, it } from "vitest";
import { makeRangeGeom, segmentPath } from "@prismshadow/penguin-ui";
import {
  benchmarkTitle,
  defaultTargetScore,
  evaluationLabel,
  labelSeries,
  latestScoreOfAgent,
  latestWithDelta,
  matchesBenchmarkQuery,
  scoreScale,
  scoreValues,
  seriesPoints,
  sparklineSeries,
  type EvaluationLabelLike,
} from "../../src/ui/metrics";

describe("the chart's scores and axis", () => {
  it("reads stored Scores and takes a malformed one as missing", () => {
    expect(scoreValues([{ score: 60 }, { score: 75.25 }])).toEqual([60, 75.25]);
    expect(scoreValues([{ score: Number.NaN }, { score: Infinity }])).toEqual([null, null]);
  });

  it("pads the observed range, clamps it to 0..100 and rounds outward to friendly ticks", () => {
    expect(scoreScale([71, 83.67, 88.33])).toEqual({
      min: 60,
      max: 100,
      ticks: [60, 70, 80, 90, 100],
    });
    expect(scoreScale([50, 50])).toEqual({ min: 40, max: 60, ticks: [40, 45, 50, 55, 60] });
    expect(scoreScale([0])).toEqual({ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] });
    expect(scoreScale([null])).toEqual({ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] });
  });
});

describe("series by label", () => {
  const runtime = { provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "xhigh" };
  const writer = { agentId: "report-writer", ...runtime };
  const support = { agentId: "support", ...runtime };

  it("keeps one agent's successive versions and providers of one model on one series", () => {
    expect(evaluationLabel({ ...writer, version: 1 }).key).toBe(
      evaluationLabel({ ...writer, version: 2, provider: "other-provider" }).key,
    );
    expect(evaluationLabel({ ...writer, version: 1 }).text).toBe(
      "report-writer · deepseek-v4-pro · xhigh",
    );
  });

  it("puts records missing the Agent or the model in one trailing unlabeled series", () => {
    const series = labelSeries([
      { agentId: null, ...runtime },
      { ...writer },
      { ...writer, modelId: "" },
      { ...support },
    ]);
    expect(series.map((s) => [s.unlabeled, s.indices])).toEqual([
      [false, [1]],
      [false, [3]],
      [true, [0, 2]],
    ]);
  });

  it("draws each series through its own points at their places on the shared axis", () => {
    const interleaved: Array<{ score: number } & EvaluationLabelLike> = [
      { score: 60, ...writer, version: 1 },
      { score: 40, ...support, version: 1 },
      { score: 70, ...writer, version: 2 },
    ];
    const [writerSeries, supportSeries] = labelSeries(interleaved);
    const writerPoints = seriesPoints(interleaved, writerSeries!);
    expect(writerPoints).toEqual([
      { index: 0, value: 60 },
      { index: 2, value: 70 },
    ]);
    const geom = makeRangeGeom(3, 0, 100, 640);
    expect(segmentPath(geom, writerPoints).split(" ")).toHaveLength(2);
    expect(segmentPath(geom, seriesPoints(interleaved, supportSeries!)).startsWith("M")).toBe(true);
  });
});

describe("the newest score and the baseline", () => {
  const label = { agentId: "report-writer", version: 1, provider: "deepseek", modelId: "m" };
  const timed = [
    { time: "2026-07-14T09:30:00Z", score: 60, ...label },
    { time: "2026-07-15T09:30:00Z", score: Number.NaN, ...label },
    { time: "2026-07-16T09:30:00Z", score: 72.35, ...label },
  ];

  it("measures the newest finite Score's change against the previous one of the same label", () => {
    expect(latestWithDelta(timed)).toEqual({
      score: 72.35,
      delta: 72.35 - 60,
      time: timed[2]!.time,
    });
    expect(latestWithDelta([timed[1]!])).toBeNull();
    expect(latestWithDelta([timed[0]!, { ...timed[2]!, modelId: "n" }])!.delta).toBeNull();
    expect(latestWithDelta([timed[0]!, { ...timed[2]!, version: 2 }])!.delta).toBe(72.35 - 60);
  });

  it("narrows the baseline to one tested Agent", () => {
    const twoAgents = [timed[0]!, { ...timed[2]!, agentId: "support", score: 90 }];
    expect(latestScoreOfAgent(twoAgents, "report-writer")!.score).toBe(60);
    expect(latestScoreOfAgent(twoAgents, "reviewer")).toBeNull();
  });

  it("draws a card's sparkline from the finite Scores in order", () => {
    expect(sparklineSeries(timed)).toEqual([60, 72.35]);
  });

  it("sets the default target ten above the baseline, capped at 100, and 80 without one", () => {
    expect(defaultTargetScore(72.35)).toBe(83);
    expect(defaultTargetScore(95)).toBe(100);
    expect(defaultTargetScore(null)).toBe(80);
  });
});

describe("the search box and the title", () => {
  const benchmark = {
    id: "report-writing-v1",
    title: "Report writing",
    titleZh: "Report writing, in Chinese",
    description: "Hard cases",
    agentIds: ["report-writer", "gone-agent"],
  };
  const agents = [
    { agentId: "report-writer", name: "Report Writer" },
    { agentId: "reviewer", name: "Reviewer" },
  ];

  it("matches the titles, description, id and tested Agents, and nothing else", () => {
    for (const q of ["WRITING", "in chinese", "hard", "-v1", "report writer", "gone"]) {
      expect(matchesBenchmarkQuery(benchmark, agents, q)).toBe(true);
    }
    expect(matchesBenchmarkQuery(benchmark, agents, "reviewer")).toBe(false);
    expect(matchesBenchmarkQuery(benchmark, agents, "   ")).toBe(true);
  });

  it("titles a Benchmark in Chinese for the Chinese interface when the manifest gives one", () => {
    expect(benchmarkTitle(benchmark, "zh")).toBe("Report writing, in Chinese");
    expect(benchmarkTitle(benchmark, "en")).toBe("Report writing");
    expect(benchmarkTitle({ title: "Only English" }, "zh")).toBe("Only English");
  });
});
