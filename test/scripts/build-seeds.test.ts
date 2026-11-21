/**
 * build-seeds: the shipped Benchmarks and the start page's Benchmarks count.
 *
 * Given a benchmark repository's `packages/` (a fixture here; the pinned commit in a release):
 * - each published package is copied as its manifest and its cases' statements, rubrics and task
 *   configs, with an empty scoreboard, and nothing else of the package comes along;
 * - a package whose id is not its folder's, that is not published, or that has no case stops the
 *   build;
 * - the count is the distinct non-empty `data_url`s, so packages of one upstream suite count once
 *   and a seed with none (the Example) not at all, and it is written into the contribution's
 *   literal;
 * - the package as shipped contributes the count its own seeds give.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyToml } from "smol-toml";
import { tempRoot } from "../helpers/host.js";
// @ts-expect-error: a plain ES module script, no declarations
import { countSuites, stagePackages, withSuiteCount } from "../../scripts/build-seeds.mjs";

const ROOT = path.join(import.meta.dirname, "..", "..");

async function writePackage(
  packages: string,
  id: string,
  options: { dataUrl?: string; status?: string; cases?: string[]; folder?: string } = {},
) {
  const dir = path.join(packages, options.folder ?? id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "benchmark_config.toml"),
    stringifyToml({
      id,
      title: id,
      status: options.status ?? "published",
      ...(options.dataUrl !== undefined ? { data_url: options.dataUrl } : {}),
    }),
  );
  for (const caseId of options.cases ?? ["CASE-001-a"]) {
    for (const part of ["statement", "rubric"]) {
      await fs.mkdir(path.join(dir, caseId, part), { recursive: true });
      await fs.writeFile(path.join(dir, caseId, part, "README.md"), `# ${part} of ${caseId}\n`);
    }
    await fs.writeFile(path.join(dir, caseId, "task_config.toml"), 'image = "x"\n');
    await fs.writeFile(path.join(dir, caseId, "solution.py"), "print('the answer')\n");
  }
  await fs.writeFile(path.join(dir, "README.md"), "upstream notes\n");
}

describe("build-seeds", () => {
  let base: string;
  let packages: string;
  let out: string;

  beforeEach(async () => {
    base = await tempRoot("rsi-seeds-test-");
    packages = path.join(base, "packages");
    out = path.join(base, "seeds");
    await fs.mkdir(packages);
    await fs.mkdir(out);
  });
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("copies a package's manifest and case materials with an empty scoreboard, and nothing else", async () => {
    await writePackage(packages, "bench-a", { dataUrl: "https://example.test/suite-a" });
    expect(await stagePackages(packages, out)).toEqual(["bench-a"]);
    const files = (await fs.readdir(path.join(out, "bench-a"), { recursive: true })).sort();
    expect(files).toEqual([
      "CASE-001-a",
      "CASE-001-a/rubric",
      "CASE-001-a/rubric/README.md",
      "CASE-001-a/statement",
      "CASE-001-a/statement/README.md",
      "CASE-001-a/task_config.toml",
      "benchmark_config.toml",
      "scoreboard.yaml",
    ]);
    expect(await fs.readFile(path.join(out, "bench-a", "scoreboard.yaml"), "utf8")).toBe(
      "evaluations: []\n",
    );
  });

  it("stops on a package whose id is not its folder's, one not published, or one with no case", async () => {
    await writePackage(packages, "bench-a", { folder: "bench-b" });
    await expect(stagePackages(packages, out)).rejects.toThrow(/does not match its folder/);
    await fs.rm(path.join(packages, "bench-b"), { recursive: true });
    await writePackage(packages, "bench-c", { status: "draft" });
    await expect(stagePackages(packages, out)).rejects.toThrow(/not published/);
    await fs.rm(path.join(packages, "bench-c"), { recursive: true });
    await writePackage(packages, "bench-d", { cases: [] });
    await expect(stagePackages(packages, out)).rejects.toThrow(/no cases/);
  });

  it("counts one suite per distinct data_url, none for a seed without one", async () => {
    await writePackage(packages, "suite-train", { dataUrl: "https://example.test/suite" });
    await writePackage(packages, "suite-test", { dataUrl: "https://example.test/suite" });
    await writePackage(packages, "other", { dataUrl: "https://example.test/other" });
    await writePackage(packages, "local");
    await stagePackages(packages, out);
    expect(await countSuites(out)).toBe(2);
  });

  it("writes the count into the contribution's literal and refuses a file without the marker", () => {
    const text = "a\n  // build-seeds:suites — x\n  value: 7,\nb";
    expect(withSuiteCount(text, 9)).toBe("a\n  // build-seeds:suites — x\n  value: 9,\nb");
    expect(() => withSuiteCount("value: 7,", 9)).toThrow(/marker/);
  });

  it("ships the count its own seeds give", async () => {
    const index = await fs.readFile(path.join(ROOT, "src", "index.ts"), "utf8");
    const suites = await countSuites(path.join(ROOT, "seeds", "benchmark"));
    expect(withSuiteCount(index, suites)).toBe(index);
  });
});
