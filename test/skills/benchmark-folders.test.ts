/**
 * Where the shipped Skills send an Agent for a Benchmark and for its Harbor checkouts.
 *
 * - A request that names no `BENCHMARK_DIR` gets the Self-Evolution Workbench's data folder of the
 *   default Agent, `<app_data_dir>/agents/default_agent/app/data/benchmark/<id>`. Every Skill file
 *   that states that default names it, and none still points at the system Agent's folder.
 * - Harbor checkouts live in the cache folder of the workbench whose data folder holds the
 *   Benchmark, `<agentDir>/app/cache/benchmark/harbor`: they can be made again and are never
 *   exported, so they are not kept in a `.harbor` folder beside the Benchmarks.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..", "..");
const DEFAULT_BENCHMARK_FOLDER = "agents/default_agent/app/data/benchmark";
const SYSTEM_AGENT_BENCHMARK_FOLDER = "system_agent/app/data/benchmark";
const HARBOR_REFERENCE = "skills/agent-evaluation/reference/harbor.md";

/** The files that tell a reader which Benchmark folder to use when the request names none. */
const STATING_THE_DEFAULT = [
  "skills/agent-evaluation/SKILL.md",
  "skills/benchmark-design/SKILL.md",
  "skills/benchmark-design/reference/package.md",
  "plugins/ace-rsi-toolkit/skills/ace-rsi-toolkit/SKILL.md",
  "plugins/ace-rsi-toolkit/skills/ace-rsi-toolkit/references/evaluation.md",
  "plugins/ape-rsi-toolkit/skills/ape-rsi-toolkit/SKILL.md",
  "plugins/ape-rsi-toolkit/skills/ape-rsi-toolkit/references/demo-task.md",
  "plugins/ape-rsi-toolkit/skills/ape-rsi-toolkit/references/evaluation.md",
  "plugins/awm-rsi-toolkit/skills/awm-rsi-toolkit/SKILL.md",
  "plugins/awm-rsi-toolkit/skills/awm-rsi-toolkit/references/evaluation.md",
  "plugins/default-rsi-toolkit/skills/agent-optimization/SKILL.md",
  "plugins/openskill-rsi-toolkit/skills/openskill-rsi-toolkit/references/evaluation.md",
  "plugins/opro-rsi-toolkit/skills/opro-rsi-toolkit/SKILL.md",
  "plugins/opro-rsi-toolkit/skills/opro-rsi-toolkit/references/demo-task.md",
  "plugins/opro-rsi-toolkit/skills/opro-rsi-toolkit/references/evaluation.md",
  "plugins/rrsi-rsi-toolkit/skills/rrsi-rsi-toolkit/SKILL.md",
  "plugins/skilladam-rsi-toolkit/skills/skilladam-rsi-toolkit/references/evaluation.md",
  "plugins/skillopt-rsi-toolkit/skills/skillopt-rsi-toolkit/references/evaluation.md",
  "plugins/trace-rsi-toolkit/skills/trace-rsi-toolkit/references/evaluation.md",
];

/** Every file under `dir`, recursively, as a "/"-separated path from the package root. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return [path.relative(ROOT, full).split(path.sep).join("/")];
  });
}

/** Every file of every shipped Skill: `skills/**` and `plugins/<toolkit>/skills/**`. */
function skillFiles(): string[] {
  const plugins = path.join(ROOT, "plugins");
  const roots = [path.join(ROOT, "skills")];
  for (const plugin of fs.readdirSync(plugins)) roots.push(path.join(plugins, plugin, "skills"));
  return roots.flatMap(filesUnder);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");
}

describe("the default Benchmark folder a Skill names", () => {
  it("is nowhere the system Agent's folder", () => {
    const files = skillFiles();
    expect(files).toContain("skills/agent-evaluation/SKILL.md");
    const stale = files.filter((rel) => read(rel).includes(SYSTEM_AGENT_BENCHMARK_FOLDER));
    expect(stale).toEqual([]);
  });

  for (const rel of STATING_THE_DEFAULT) {
    it(`is the default Agent's workbench folder in ${rel}`, () => {
      expect(read(rel)).toContain(DEFAULT_BENCHMARK_FOLDER);
    });
  }
});

describe("Harbor checkouts", () => {
  it("are described in the workbench's cache folder, not beside the Benchmarks", () => {
    const text = read(HARBOR_REFERENCE);
    expect(text).toContain("cache/benchmark/harbor");
    expect(text).not.toContain("/.harbor");
  });

  it("land in the cache folder of the Agent whose data folder holds the Benchmark", () => {
    const line = read(HARBOR_REFERENCE)
      .split("\n")
      .find((l) => l.trimStart().startsWith("CHECKOUT_ROOT="));
    expect(line, "harbor.md sets CHECKOUT_ROOT").toBeDefined();
    const agentDir = "/srv/penguin/projects/demo/agents/default_agent";
    const script = [
      `BENCHMARK_DIR='${agentDir}/app/data/benchmark/sample-bench'`,
      line!.trim(),
      'printf %s "$CHECKOUT_ROOT"',
    ].join("\n");
    const checkoutRoot = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(checkoutRoot).toBe(`${agentDir}/app/cache/benchmark/harbor`);
  });
});
