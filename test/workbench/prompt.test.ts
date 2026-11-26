/**
 * What a Start sends (`GET …/prompt?kind=…`, or `POST …/prompt` with the same fields as JSON):
 * the request a task's conversation opens with, the Skills it preselects and those it cannot run
 * without (workbenches/benchmark/lib/prompt-request.ts and lib/prompts.ts, through the handler).
 *
 * Given a workbench that holds the Benchmark `sec-a` (two runs a case) and not `elsewhere`:
 * - When a form asks for its request, in English or in Chinese, the person's words come first and
 *   the tail after them names the Skill to use and the parameters it needs, written in that
 *   language; a query and a JSON body with the same fields get the same answer.
 * - When the request is about a Benchmark, the folder it names is the Benchmark's absolute folder
 *   in the workbench's data folder, or, for one the workbench does not hold, the Skills' own rule
 *   under the App Data Dir. A create or an import names the data folder new Benchmarks go in.
 * - When the kind is create, both the design and the evaluation Skill are preselected and
 *   required; an import preselects the design Skill and requires none; an evaluation the
 *   evaluation Skill; the default loop the optimizer and the evaluator, its runs the Benchmark's
 *   own unless the form says; a paper's toolkit the Skill the form names; a question none.
 * - When a field is out of shape, the answer is a 400 naming it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PromptResponse } from "../../workbenches/benchmark/lib/api.js";
import {
  createTestWorkbench,
  errorOf,
  statusOf,
  type TestWorkbench,
} from "../helpers/workbench.js";

const MODEL = { provider: "deepseek", modelId: "deepseek-v4-pro" };
/** Where a Benchmark this workbench does not hold is, by the Skills' rule. */
const APP_DATA_BENCHMARKS = "<app_data_dir>/agents/default_agent/app/data/benchmark";

/** The fields of a prompt request as the page's query carries them: integers as digits, the nested fields as JSON. */
function promptUrl(fields: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    query.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return `/prompt?${query}`;
}

const LANGUAGES = {
  /** A parameter line of a tail, as the Skill reads it. */
  en: { line: (key: string, value: string | number) => `- ${key}: \`${value}\`` },
  zh: { line: (key: string, value: string | number) => `- ${key}：\`${value}\`` },
} as const;

const EVALUATION_FACTS = {
  time: "2026-10-08 10:00",
  label: "default_agent v3",
  version: 3,
  provider: "deepseek",
  modelId: "deepseek-v4-pro",
  thinkingLevel: "medium",
  score: "50.00",
  cost: "$0.04",
  duration: "1m 2s",
  summaryTitle: "",
  summary: "",
  cases: [
    {
      id: "CASE-001-a",
      score: "50.00",
      cost: "$0.04",
      duration: "1m 2s",
      sessionIds: ["session-run-1", "session-run-2"],
    },
  ],
};

describe("the prompt a Start sends", () => {
  let wb: TestWorkbench;
  /** The held Benchmark's folder, as the prompts name it. */
  let held: string;

  beforeAll(async () => {
    wb = await createTestWorkbench();
    const dir = path.join(wb.dataDir, "sec-a");
    await fs.mkdir(path.join(dir, "CASE-001-a", "statement"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "benchmark_config.toml"),
      stringifyToml({ id: "sec-a", title: "Sec A", status: "published", runs: 2 }),
    );
    await fs.writeFile(path.join(dir, "CASE-001-a", "statement", "README.md"), "# A\n");
    held = `${wb.dataDir}/sec-a`;
    return () => wb.dispose();
  });

  /** The answer to `fields`, asked both ways; a query and a body must agree. */
  async function promptOf(fields: Record<string, unknown>): Promise<PromptResponse> {
    const asked = await wb.get(promptUrl(fields));
    const posted = await wb.post("/prompt", fields);
    expect(statusOf(asked), JSON.stringify(asked.body)).toBe(200);
    expect(statusOf(posted)).toBe(200);
    expect(asked.body).toEqual(posted.body);
    return posted.body as PromptResponse;
  }

  describe.each(["en", "zh"] as const)("in %s", (language) => {
    const { line } = LANGUAGES[language];

    it("an evaluation puts the person's note first, then the evaluation Skill and its parameters, the Benchmark's own folder among them", async () => {
      const notes = "Watch the citation cases.";

      const res = await promptOf({
        kind: "evaluate",
        language,
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        runs: 3,
        testedModel: MODEL,
        notes,
      });

      expect(res.prompt.startsWith(`${notes}\n\n`)).toBe(true);
      expect(res.prompt).toContain("`agent-evaluation`");
      for (const expected of [
        line("test_agent_id", "writer"),
        line("benchmark_id", "sec-a"),
        line("BENCHMARK_DIR", held),
        line("runs", 3),
        line("provider", "deepseek"),
        line("model_id", "deepseek-v4-pro"),
      ]) {
        expect(res.prompt).toContain(expected);
      }
      expect(res.skills).toEqual(["agent-evaluation"]);
      expect(res.required).toEqual(["agent-evaluation"]);
    });

    it("a Benchmark this workbench does not hold is named by the Skills' rule under the App Data Dir", async () => {
      const res = await promptOf({
        kind: "evaluate",
        language,
        benchmarkId: "elsewhere",
        targetAgentId: "writer",
        runs: 1,
        testedModel: MODEL,
      });

      expect(res.prompt).toContain(line("BENCHMARK_DIR", `${APP_DATA_BENCHMARKS}/elsewhere`));
      expect(res.prompt).not.toContain(wb.dataDir);
    });

    it("a create asks the design Skill for a Benchmark for the Test Agent in the data folder, both Skills required", async () => {
      const notes = "Test report writing under contradicting sources.";

      const res = await promptOf({ kind: "create", language, targetAgentId: "writer", notes });

      expect(res.prompt.startsWith(`${notes}\n\n`)).toBe(true);
      expect(res.prompt).toContain("`benchmark-design`");
      expect(res.prompt).toContain(line("test_agent_id", "writer"));
      expect(res.prompt).toContain(`\`${wb.dataDir}/<benchmark_id>/\``);
      expect(res.skills).toEqual(["benchmark-design", "agent-evaluation"]);
      expect(res.required).toEqual(["benchmark-design", "agent-evaluation"]);
    });

    it("an import leads with the source, by its kind, and copies into the data folder, the design Skill offered but not required", async () => {
      const sources = [
        "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/x",
        "/srv/packages/report-writing-v1",
        "the SWE-bench Verified package",
      ];

      const answers = [];
      for (const source of sources)
        answers.push(await promptOf({ kind: "import", language, source }));

      const leads = answers.map((res) => res.prompt.split("\n", 1)[0]!);
      sources.forEach((source, i) => expect(leads[i]).toContain(source));
      // A repository folder, a local path and a reference each get their own lead.
      expect(new Set(leads.map((lead, i) => lead.replace(sources[i]!, ""))).size).toBe(3);
      for (const res of answers) {
        expect(res.prompt).toContain(`\`${wb.dataDir}/<id>/\``);
        expect(res.skills).toEqual(["benchmark-design"]);
        expect(res.required).toEqual([]);
      }
    });

    it("the default loop names the optimizer with its round limit and target score, runs defaulting to the Benchmark's own", async () => {
      const notes = "Focus on the citations.";

      const res = await promptOf({
        kind: "optimize",
        language,
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "default-rsi-toolkit",
        testedModel: MODEL,
        roundLimit: 5,
        targetScore: 80,
        notes,
      });
      const withRuns = await promptOf({
        kind: "optimize",
        language,
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "default-rsi-toolkit",
        testedModel: MODEL,
        roundLimit: 5,
        targetScore: 80,
        runs: 4,
      });

      expect(res.prompt.startsWith(`${notes}\n\n`)).toBe(true);
      expect(res.prompt).toContain("`agent-optimization`");
      for (const expected of [
        line("BENCHMARK_DIR", held),
        line("runs", 2),
        line("desired_score", ">=80"),
        line("candidate_round_limit", 5),
        line("model_id", "deepseek-v4-pro"),
      ]) {
        expect(res.prompt).toContain(expected);
      }
      expect(withRuns.prompt).toContain(line("runs", 4));
      expect(res.skills).toEqual(["agent-optimization", "agent-evaluation"]);
      expect(res.required).toEqual(["agent-optimization", "agent-evaluation"]);
    });

    it("a paper's toolkit runs through the Skill the form names, tested three times unless the form says", async () => {
      const paper = {
        kind: "optimize",
        language,
        benchmarkId: "sec-a",
        targetAgentId: "writer",
        method: "opro-rsi-toolkit",
        skill: "opro-rsi-toolkit",
        testedModel: MODEL,
      };

      const res = await promptOf(paper);
      const repeated = await promptOf({ ...paper, testRepetitions: 5 });

      expect(res.prompt).toContain("`opro-rsi-toolkit`");
      expect(res.prompt).not.toContain("`agent-optimization`");
      expect(res.prompt).toContain(line("BENCHMARK_DIR", held));
      expect(res.prompt).toContain(line("test_repetitions", 3));
      expect(repeated.prompt).toContain(line("test_repetitions", 5));
      expect(res.skills).toEqual(["opro-rsi-toolkit"]);
      expect(res.required).toEqual(["opro-rsi-toolkit"]);
    });

    it("a question about a case asks first and names its statement and rubric in the Benchmark's folder, with no Skill", async () => {
      const question = "What does this case test?";

      const res = await promptOf({
        kind: "ask",
        language,
        benchmarkId: "sec-a",
        question,
        case: {
          caseId: "CASE-001-a",
          latest: {
            time: "2026-10-08 10:00",
            score: "50.00",
            runs: [{ score: "50.00", sessionId: "session-run-1" }],
          },
        },
      });

      expect(res.prompt.startsWith(`${question}\n\n`)).toBe(true);
      expect(res.prompt).toContain(`\`${held}/CASE-001-a/statement/README.md\``);
      expect(res.prompt).toContain(`\`${held}/CASE-001-a/rubric/README.md\``);
      expect(res.prompt).toContain("`session-run-1`");
      expect(res.skills).toEqual([]);
      expect(res.required).toEqual([]);
    });

    it("a question about an evaluation names the scoreboard and every run's Session, with no Skill", async () => {
      const question = "Why is CASE-001-a so low?";

      const res = await promptOf({
        kind: "ask",
        language,
        benchmarkId: "sec-a",
        question,
        evaluation: EVALUATION_FACTS,
      });

      expect(res.prompt.startsWith(`${question}\n\n`)).toBe(true);
      expect(res.prompt).toContain(line("BENCHMARK_DIR", held));
      expect(res.prompt).toContain(`\`${held}/scoreboard.yaml\``);
      expect(res.prompt).toContain("`session-run-1`");
      expect(res.prompt).toContain("`session-run-2`");
      expect(res.skills).toEqual([]);
      expect(res.required).toEqual([]);
    });
  });

  it("the two languages ask the same thing in different words", async () => {
    const fields = {
      kind: "evaluate",
      benchmarkId: "sec-a",
      targetAgentId: "writer",
      runs: 3,
      testedModel: MODEL,
    };

    const en = await promptOf({ ...fields, language: "en" });
    const zh = await promptOf({ ...fields, language: "zh" });
    const byDefault = await promptOf(fields);

    expect(zh.prompt).not.toBe(en.prompt);
    expect(byDefault).toEqual(en);
    expect(zh.skills).toEqual(en.skills);
  });
});

describe("a prompt request out of shape", () => {
  let wb: TestWorkbench;

  beforeEach(async () => {
    wb = await createTestWorkbench();
  });
  afterEach(async () => {
    await wb.dispose();
  });

  const evaluate = {
    kind: "evaluate",
    benchmarkId: "sec-a",
    targetAgentId: "writer",
    runs: 2,
    testedModel: MODEL,
  };
  const optimize = {
    kind: "optimize",
    benchmarkId: "sec-a",
    targetAgentId: "writer",
    method: "default-rsi-toolkit",
    testedModel: MODEL,
    roundLimit: 5,
    targetScore: 80,
  };
  const ask = { kind: "ask", benchmarkId: "sec-a", question: "Why?" };

  /** [what, the body, the field the refusal names]. */
  const bodies: Array<[string, Record<string, unknown>, string]> = [
    ["a kind nobody defined", { ...evaluate, kind: "rewrite" }, "kind"],
    ["a language other than en or zh", { ...evaluate, language: "fr" }, "language"],
    ["a create with no Test Agent", { kind: "create", notes: "x" }, "targetAgentId"],
    ["an Agent id that is no id", { ...evaluate, targetAgentId: "../writer" }, "targetAgentId"],
    ["a blank import source", { kind: "import", source: "   " }, "source"],
    ["an evaluation with no runs", { ...evaluate, runs: undefined }, "runs"],
    ["zero runs", { ...evaluate, runs: 0 }, "runs"],
    ["a Benchmark id that climbs out", { ...evaluate, benchmarkId: "../escape" }, "benchmarkId"],
    ["no tested model", { ...evaluate, testedModel: undefined }, "testedModel"],
    [
      "a tested model with no provider",
      { ...evaluate, testedModel: { modelId: "m" } },
      "testedModel.provider",
    ],
    [
      "the default loop without a round limit",
      { ...optimize, roundLimit: undefined },
      "roundLimit",
    ],
    ["a target score past 100", { ...optimize, targetScore: 101 }, "targetScore"],
    ["a paper's toolkit without its Skill", { ...optimize, method: "opro-rsi-toolkit" }, "skill"],
    ["a question about nothing", ask, "evaluation"],
    [
      "a question about an evaluation and a case at once",
      { ...ask, evaluation: EVALUATION_FACTS, case: { caseId: "CASE-001-a", latest: null } },
      "evaluation",
    ],
    [
      "a case id that is no case",
      { ...ask, case: { caseId: "README", latest: null } },
      "case.caseId",
    ],
    [
      "an evaluation whose cases are no list",
      { ...ask, evaluation: { ...EVALUATION_FACTS, cases: "all" } },
      "evaluation.cases",
    ],
  ];

  it.each(bodies)("refuses %s, naming the field", async (_what, body, field) => {
    const res = await wb.post("/prompt", body);

    expect(statusOf(res)).toBe(400);
    expect(errorOf(res).code).toBe("bad_request");
    expect(errorOf(res).message).toContain(field);
  });

  it.each([
    ["a nested field that is not JSON", "testedModel", "{provider"],
    ["an integer field that is not digits", "runs", "two"],
    ["an integer field with a fraction", "runs", "1.5"],
  ])("refuses a query with %s, naming the field", async (_what, key, value) => {
    const res = await wb.get(promptUrl({ ...evaluate, [key]: value }));

    expect(statusOf(res)).toBe(400);
    expect(errorOf(res).code).toBe("bad_request");
    expect(errorOf(res).message).toContain(key);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await wb.request("POST", "/prompt", {
      bytes: new TextEncoder().encode("kind=evaluate"),
    });

    expect(statusOf(res)).toBe(400);
    expect(errorOf(res).code).toBe("bad_request");
  });
});
