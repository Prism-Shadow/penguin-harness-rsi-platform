/**
 * build-seeds: the Benchmarks the workbench folder ships as its seeds, and their catalog.
 *
 * Given a benchmark repository's `packages/` (a fixture here; the pinned commit in a release):
 * - each published package is copied as its manifest and its cases' statements, rubrics and task
 *   configs, with an empty scoreboard, and nothing else of the package comes along;
 * - a package whose id is not its folder's, that is not published, or that has no case stops the
 *   build;
 * - the catalog lists every seed folder by id, with its title, its Chinese title and its
 *   `data_url` when the manifest gives them (packages of one upstream suite share their
 *   `data_url`), in id order; a seed with no title goes by its id, and neither a file beside the
 *   seeds nor a folder without a manifest is listed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyToml } from "smol-toml";
import { tempRoot } from "../helpers/workbench.js";
// @ts-expect-error: a plain ES module script, no declarations
import { catalogOf, stagePackages } from "../../scripts/build-seeds.mjs";

interface PackageOptions {
  title?: string;
  titleZh?: string;
  dataUrl?: string;
  status?: string;
  cases?: string[];
  folder?: string;
}

async function writePackage(packages: string, id: string, options: PackageOptions = {}) {
  const dir = path.join(packages, options.folder ?? id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "benchmark_config.toml"),
    stringifyToml({
      id,
      title: options.title ?? id,
      ...(options.titleZh !== undefined ? { title_zh: options.titleZh } : {}),
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
    const files = (await fs.readdir(path.join(out, "bench-a"), { recursive: true }))
      .map((file) => file.split(path.sep).join("/"))
      .sort();
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

  it("catalogs every seed by id with its title, Chinese title and data_url, in id order", async () => {
    await writePackage(packages, "suite-train", {
      title: "Suite (train)",
      titleZh: "套件（训练）",
      dataUrl: "https://example.test/suite",
    });
    await writePackage(packages, "suite-test", {
      title: "Suite (test)",
      dataUrl: "https://example.test/suite",
    });
    await writePackage(packages, "local", { title: "Local" });
    await stagePackages(packages, out);

    expect(await catalogOf(out)).toEqual([
      { id: "local", title: "Local" },
      { id: "suite-test", title: "Suite (test)", data_url: "https://example.test/suite" },
      {
        id: "suite-train",
        title: "Suite (train)",
        title_zh: "套件（训练）",
        data_url: "https://example.test/suite",
      },
    ]);
  });

  it("names a seed without a title by its id, leaves blank keys out, and lists neither a file beside the seeds nor a folder without a manifest", async () => {
    await writePackage(packages, "untitled", { title: " ", titleZh: "", dataUrl: "" });
    await stagePackages(packages, out);
    // The previous build's catalog, and a folder that is no Benchmark.
    await fs.writeFile(path.join(out, "catalog.json"), "[]\n");
    await fs.mkdir(path.join(out, "scratch", "CASE-001-a"), { recursive: true });

    expect(await catalogOf(out)).toEqual([{ id: "untitled", title: "untitled" }]);
  });
});
