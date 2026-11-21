/**
 * The Example Benchmark as data (scripts/example-benchmark.mjs), which scripts/build-seeds.mjs
 * writes into the seeds every new Project starts with.
 *
 * Given the Example's manifest, cases and sample scoreboard:
 * - When its manifest goes through the format, it is one a Benchmark may be written with, and it
 *   reads back as a published, built-in package with a date version.
 * - When its scoreboard is written as YAML and read back by the format's parser, every
 *   evaluation survives, oldest first, each of default_agent on every case of the Example, each run
 *   naming the Session it ran in, with the averages as the file states them.
 * - When its averages are checked against its runs, they are the model-written averages the
 *   scoreboard contract prescribes: run costs keep their precision, scores two decimals, costs six
 *   with unknown costs left out, durations whole milliseconds.
 */
import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  DATE_VERSION_PATTERN,
  checkBenchmarkManifest,
  parseBenchmarkManifest,
  parseScoreboard,
  serializeBenchmarkManifest,
  type BenchmarkManifest,
} from "../../src/format/index.js";

interface RunScore {
  score: number;
  cost: number | null;
  duration_ms: number;
  session_id: string;
}
interface CaseScore extends Omit<RunScore, "session_id"> {
  case: string;
  runs: RunScore[];
}
interface Evaluation extends Omit<CaseScore, "case" | "runs"> {
  time: string;
  agent_id: string;
  cases: CaseScore[];
}

/** What the plain-JS data module exports, as far as these scenarios read it. */
interface ExampleModule {
  EXAMPLE_BENCHMARK_ID: string;
  EXAMPLE_BENCHMARK_MANIFEST: BenchmarkManifest;
  EXAMPLE_CASES: Array<{ id: string; statement: string; rubric: string }>;
  buildExampleScoreboard(): { evaluations: Evaluation[] };
}

// The module is plain JS without declarations: a non-literal specifier for the type checker, the
// same literal path once the types are stripped for the run.
const example = (await import("../../scripts/example-benchmark.mjs" as string)) as ExampleModule;

describe("the Example Benchmark", () => {
  it("its manifest is one the format writes, and reads back as a published built-in package with a date version", () => {
    const written = example.EXAMPLE_BENCHMARK_MANIFEST;

    expect(() => checkBenchmarkManifest(written)).not.toThrow();
    const read = parseBenchmarkManifest(
      serializeBenchmarkManifest(written),
      example.EXAMPLE_BENCHMARK_ID,
    );

    expect(read).toEqual(written);
    expect(read).toMatchObject({ status: "published", origin: { kind: "builtin" } });
    expect(read.version).toMatch(DATE_VERSION_PATTERN);
  });

  it("its scoreboard reads back whole: every evaluation, oldest first, each of default_agent on every case, each run naming its Session", () => {
    const built = example.buildExampleScoreboard().evaluations;

    const parsed = parseScoreboard(stringifyYaml({ evaluations: built }));

    expect(built.length).toBeGreaterThan(0);
    expect(parsed).toHaveLength(built.length);
    const times = parsed.map((e) => Date.parse(e.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const caseIds = example.EXAMPLE_CASES.map((c) => c.id).sort();
    for (const evaluation of parsed) {
      expect(evaluation.agentId).toBe("default_agent");
      expect(evaluation.cases.map((c) => c.case).sort()).toEqual(caseIds);
      for (const c of evaluation.cases) {
        for (const run of c.runs) {
          expect(run.sessionId).toMatch(
            /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/,
          );
        }
      }
    }
    // The averages are the file's, as written: nothing recomputes them on the way in.
    expect(parsed.map((e) => [e.score, e.cost, e.durationMs])).toEqual(
      built.map((e) => [e.score, e.cost, e.duration_ms]),
    );
  });

  it("its averages are the model-written ones the scoreboard contract prescribes, run costs kept at their precision", () => {
    const { evaluations } = example.buildExampleScoreboard();
    const avg = (vals: number[]): number => vals.reduce((a, b) => a + b, 0) / vals.length;
    const knownCostAvg = (vals: Array<number | null>): number | null => {
      const known = vals.filter((value): value is number => value !== null);
      return known.length > 0 ? Math.round(avg(known) * 1_000_000) / 1_000_000 : null;
    };
    const two = (value: number): number => Math.round(value * 100) / 100;

    expect(evaluations[0]?.cases[0]?.runs.map((run) => run.cost)).toEqual([0.012, 0.014]);
    for (const e of evaluations) {
      for (const c of e.cases) {
        expect(c.runs.every((run) => run.score >= 0 && run.score <= 100)).toBe(true);
        expect(c.score).toBe(two(avg(c.runs.map((r) => r.score))));
        expect(c.cost).toBe(knownCostAvg(c.runs.map((r) => r.cost)));
        expect(c.duration_ms).toBe(Math.round(avg(c.runs.map((r) => r.duration_ms))));
      }
      expect(e.score).toBe(two(avg(e.cases.map((c) => c.score))));
      expect(e.cost).toBe(knownCostAvg(e.cases.map((c) => c.cost)));
      expect(e.duration_ms).toBe(Math.round(avg(e.cases.map((c) => c.duration_ms))));
    }
  });
});
