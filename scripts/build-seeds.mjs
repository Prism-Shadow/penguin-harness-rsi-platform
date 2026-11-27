/**
 * build-seeds: writes `workbenches/benchmark/seeds/`, the Benchmarks the workbench writes into
 * its data folder the first time it loads, and their `catalog.json`, from the benchmark
 * repository at one pinned commit.
 *
 *   node scripts/build-seeds.mjs                    # fetch the pinned commit from GitHub
 *   node scripts/build-seeds.mjs --repo <checkout>  # read it from a local clone that has it
 *   node scripts/build-seeds.mjs --check [...]      # fail when the seeds or the catalog would change
 *
 * The built-in Benchmarks are the `packages/*` of Prism-Shadow/penguin-harness-benchmark at
 * PINNED_COMMIT: each package's `benchmark_config.toml` as it is, and per `CASE-*` its
 * `statement/README.md`, `rubric/README.md` and `task_config.toml` (when it has one); every copy
 * gets an empty `scoreboard.yaml`. Beside them, the Example Benchmark (example-benchmark.mjs),
 * with its sample evaluations. The workbench's handler copies these folders into its data folder
 * once (workbenches/benchmark/lib/seeds.ts), so the seeds are part of this package's integrity:
 * moving the pin is a change to the package, reviewed like any other.
 *
 * `catalog.json` lists every seed by id with its title, Chinese title and `data_url` (catalogOf),
 * for the harness's gallery and landing page, which count the upstream suites by `data_url` (the
 * GDPevo packages share one; the Example has none). It is a file, so the handler's seeding, which
 * copies folders, leaves it where it is.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import {
  EXAMPLE_BENCHMARK_ID,
  EXAMPLE_BENCHMARK_MANIFEST,
  EXAMPLE_CASES,
  buildExampleScoreboard,
} from "./example-benchmark.mjs";

export const BENCHMARK_REPOSITORY = "https://github.com/Prism-Shadow/penguin-harness-benchmark.git";
/** The benchmark repository's commit the seeds are built from: "move task data to seven public repositories" (#38). */
export const PINNED_COMMIT = "b44bb87feba731a9e342a9054b2d8641f48e589c";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEEDS_DIR = path.join(ROOT, "workbenches", "benchmark", "seeds");
const CATALOG_FILE = "catalog.json";

/** Code-unit order: the same on every machine, whatever its locale. */
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The Example's manifest as the format writes one: TOML, the keys in one order, `[origin]` last. */
function exampleManifest() {
  const m = EXAMPLE_BENCHMARK_MANIFEST;
  return stringifyToml({
    id: m.id,
    title: m.title,
    description: m.description,
    description_zh: m.descriptionZh,
    version: m.version,
    status: m.status,
    runs: m.runs,
    origin: { kind: m.origin.kind },
  });
}

/** Writes the Example Benchmark into `outDir/<id>/`. */
async function writeExample(outDir) {
  const dir = path.join(outDir, EXAMPLE_BENCHMARK_ID);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "benchmark_config.toml"), exampleManifest(), "utf8");
  await fs.writeFile(
    path.join(dir, "scoreboard.yaml"),
    stringifyYaml(buildExampleScoreboard()),
    "utf8",
  );
  for (const c of EXAMPLE_CASES) {
    for (const [part, text] of [
      ["statement", c.statement],
      ["rubric", c.rubric],
    ]) {
      await fs.mkdir(path.join(dir, c.id, part), { recursive: true });
      await fs.writeFile(path.join(dir, c.id, part, "README.md"), text, "utf8");
    }
  }
}

/**
 * Copies every Benchmark package under `packagesDir` into `outDir/<id>/`, as the module doc says.
 * A package whose `id` is not its folder's name, that is not published, or that has no case is a
 * mistake upstream, and stops the build rather than shipping half a Benchmark.
 */
export async function stagePackages(packagesDir, outDir) {
  const ids = [];
  for (const entry of (await fs.readdir(packagesDir, { withFileTypes: true })).sort(byName)) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(packagesDir, entry.name);
    if (!existsSync(path.join(dir, "benchmark_config.toml"))) continue;
    const manifest = await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8");
    const config = parseToml(manifest);
    if (config.id !== entry.name) throw new Error(`Benchmark id does not match its folder: ${dir}`);
    if (config.status !== "published") throw new Error(`Benchmark is not published: ${dir}`);
    const dest = path.join(outDir, entry.name);
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "benchmark_config.toml"), manifest);
    await fs.writeFile(path.join(dest, "scoreboard.yaml"), "evaluations: []\n", "utf8");
    let cases = 0;
    for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort(byName)) {
      if (!item.isDirectory() || !item.name.startsWith("CASE-")) continue;
      const caseDir = path.join(dir, item.name);
      for (const part of ["statement", "rubric"]) {
        const text = await fs.readFile(path.join(caseDir, part, "README.md"), "utf8");
        await fs.mkdir(path.join(dest, item.name, part), { recursive: true });
        await fs.writeFile(path.join(dest, item.name, part, "README.md"), text, "utf8");
      }
      const taskConfig = path.join(caseDir, "task_config.toml");
      if (existsSync(taskConfig)) {
        await fs.copyFile(taskConfig, path.join(dest, item.name, "task_config.toml"));
      }
      cases += 1;
    }
    if (cases === 0) throw new Error(`Benchmark has no cases: ${dir}`);
    ids.push(entry.name);
  }
  if (ids.length === 0) throw new Error(`No Benchmark packages found in ${packagesDir}`);
  return ids;
}

/**
 * The catalog of the seeds in `seedsDir`: one `{ id, title, title_zh?, data_url? }` per seed, by
 * id, read from each manifest. The harness's gallery and landing page list the built-in Benchmarks
 * from it without reading every manifest, and count the upstream suites by their `data_url`.
 */
export async function catalogOf(seedsDir) {
  const out = [];
  for (const entry of (await fs.readdir(seedsDir, { withFileTypes: true })).sort(byName)) {
    if (!entry.isDirectory()) continue;
    const file = path.join(seedsDir, entry.name, "benchmark_config.toml");
    if (!existsSync(file)) continue;
    const manifest = parseToml(await fs.readFile(file, "utf8"));
    const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
    const titleZh = text(manifest.title_zh);
    const dataUrl = text(manifest.data_url);
    out.push({
      id: entry.name,
      title: text(manifest.title) ?? entry.name,
      ...(titleZh !== undefined ? { title_zh: titleZh } : {}),
      ...(dataUrl !== undefined ? { data_url: dataUrl } : {}),
    });
  }
  return out;
}

/** The benchmark repository's `packages/` at the pin, extracted under `temp`. */
function fetchPackages(temp, repo) {
  const git = (args, opts = {}) => execFileSync("git", args, { stdio: "pipe", ...opts });
  let source = repo;
  if (source === undefined) {
    source = path.join(temp, "repo");
    git(["init", "-q", source]);
    git(["-C", source, "fetch", "-q", "--depth=1", BENCHMARK_REPOSITORY, PINNED_COMMIT]);
  }
  const tar = git(["-C", source, "archive", "--format=tar", PINNED_COMMIT, "packages"], {
    maxBuffer: 1 << 30,
  });
  const out = path.join(temp, "extract");
  mkdirSync(out, { recursive: true });
  execFileSync("tar", ["-x", "-C", out], { input: tar, stdio: ["pipe", "pipe", "pipe"] });
  return path.join(out, "packages");
}

/** Every file under `dir`, relative, sorted. */
async function listFiles(dir, rel = "") {
  const out = [];
  for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort(
    byName,
  )) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, child)));
    else out.push(child);
  }
  return out;
}

/** Whether two folders hold the same files with the same bytes. */
async function sameTree(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const [fa, fb] = await Promise.all([listFiles(a), listFiles(b)]);
  if (fa.join("\n") !== fb.join("\n")) return false;
  for (const rel of fa) {
    const [x, y] = await Promise.all([
      fs.readFile(path.join(a, rel)),
      fs.readFile(path.join(b, rel)),
    ]);
    if (!x.equals(y)) return false;
  }
  return true;
}

async function main() {
  const { values } = parseArgs({
    options: { repo: { type: "string" }, check: { type: "boolean" } },
  });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "rsi-seeds-"));
  try {
    const packages = fetchPackages(temp, values.repo && path.resolve(values.repo));
    const staged = path.join(temp, "seeds");
    await fs.mkdir(staged);
    const ids = await stagePackages(packages, staged);
    await writeExample(staged);
    const catalog = await catalogOf(staged);
    await fs.writeFile(
      path.join(staged, CATALOG_FILE),
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );
    const suites = new Set(catalog.flatMap((seed) => (seed.data_url ? [seed.data_url] : []))).size;
    if (values.check) {
      const fresh = await sameTree(staged, SEEDS_DIR);
      console.log(
        fresh
          ? `workbenches/benchmark/seeds/ is the pinned commit's (${ids.length} packages, ${suites} suites)`
          : `workbenches/benchmark/seeds/ differs from ${PINNED_COMMIT}: run node scripts/build-seeds.mjs`,
      );
      process.exitCode = fresh ? 0 : 1;
      return;
    }
    await fs.rm(SEEDS_DIR, { recursive: true, force: true });
    await fs.mkdir(path.dirname(SEEDS_DIR), { recursive: true });
    await fs.cp(staged, SEEDS_DIR, { recursive: true });
    console.log(
      `workbenches/benchmark/seeds/: ${ids.length} packages from ${PINNED_COMMIT} and the Example; ${suites} upstream suites`,
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
