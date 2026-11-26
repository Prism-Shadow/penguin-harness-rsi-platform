/**
 * The Benchmarks of a Project as this server holds them, in the folder the host names for the
 * workbench's data (`AppData.dataPaths(p, "benchmark").dataDir`; PRFC-0034 puts it at
 * `<root>/projects/<p>/agents/system_agent/app/data/benchmark/`). Moved from the harness's
 * Evaluation Center (packages/server services/benchmark-service.ts), behaviour unchanged.
 *
 * Walks `<dir>/<id>/`, reads the manifest `benchmark_config.toml` (../format/manifest.ts: title,
 * description, per-case run count `runs`, the build `status` — `draft` while the Benchmark is still
 * being written, `failed` when its calibration never produced a result to freeze, `published`
 * otherwise — and, when the file has them, the date `version` and the `origin`) and
 * `scoreboard.yaml` (../format/scoreboard.ts: evaluations[], each carrying the Agent it tested,
 * each case its model-written averages and a runs array). Content is normally created and refined
 * by the benchmark-design Skill; the server also writes the same layout for a Benchmark created by
 * hand (`create`) or uploaded as a package (`importArchive`, whose copy starts with an empty
 * scoreboard and whose overwrite replaces the directory whole, though never while an evaluation of
 * it is still running), packs a Benchmark's package for download (`exportArchive`), and removes a
 * Benchmark directory whole (`remove`); it never edits a scoreboard, and never rewrites a manifest
 * in place. A built-in Benchmark is read like any other.
 *
 * A manifest is what makes a directory a Benchmark: `list` skips one without it. A manifest
 * written before `id`, `version` and `origin` existed is read as it is, unversioned and of
 * unknown origin; reading never rewrites one. A manifest that is there but says something
 * unusable lists the Benchmark as failed, under its directory name, with `manifestError` saying
 * why, so nothing offers to use it; a corrupt scoreboard degrades to no scores. A filesystem error
 * reading a manifest is not a fact about the Benchmark and fails the request.
 *
 * Case and Evaluation averages are authoritative file values: validated, never recomputed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  BenchmarkManifestError,
  checkBenchmarkManifest,
  readBenchmarkManifest,
  writeBenchmarkManifest,
  type BenchmarkManifest,
} from "../format/manifest.js";
import { nextDateVersion } from "../format/dates.js";
import { SCOREBOARD_FILE, emptyScoreboard, parseScoreboard } from "../format/scoreboard.js";
import type {
  BenchmarkArchiveGitOrigin,
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkEvaluation,
  BenchmarkOrigin,
  BenchmarkSummary,
  BenchmarksResponse,
  CaseFilesResponse,
  CaseMaterial,
} from "../api.js";
import { casePage } from "../api.js";
import { packBenchmark, readBenchmarkArchive } from "./archive.js";
import { WorkbenchError } from "./errors.js";
import type { CaseFileContent, CaseFiles } from "./host.js";
import { placeBenchmark } from "./place.js";

const STATEMENT_TITLE_READ_BYTES = 64 * 1024;

/** One case of a hand-made Benchmark; ids are validated by the route before they reach the filesystem. */
export interface BenchmarkCaseInput {
  id: string;
  title: string;
  statement: string;
  rubric: string;
}

export interface BenchmarkCreateInput {
  id: string;
  title: string;
  description?: string;
  runs: number;
  cases: BenchmarkCaseInput[];
}

/** How an uploaded package is written: over a taken id or not, and where it came from. */
export interface BenchmarkImportOptions {
  overwrite: boolean;
  /** The repository folder the package was fetched from; absent for an upload, whose origin is `zip`. */
  origin?: BenchmarkArchiveGitOrigin;
}

/** A Benchmark's package as a zip, and the name its download is offered under. */
export interface BenchmarkArchive {
  /** `<id>-v<version>.zip`. */
  fileName: string;
  data: Uint8Array;
}

/** A taken id: `details.benchmarkId` names it, for the Web App's overwrite confirm and the CLI. */
function benchmarkExists(id: string): WorkbenchError {
  return new WorkbenchError(409, "benchmark_exists", `Benchmark already exists: ${id}`, undefined, {
    benchmarkId: id,
  });
}

/** Whether anything is under `p`; a symlink counts, wherever it points. */
async function occupied(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** A directory's entries in code-unit order; none when it is missing or is not a directory. */
async function entriesOf(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

/**
 * The first entry under `benchDir/.jobs/` that marks an evaluation still running, or null. A
 * Benchmark whose cases run through Harbor is evaluated one trial at a time into `.jobs/`
 * (agent-evaluation's reference/harbor.md): a cell writes the Test Agent's State to
 * `.jobs/<job>.agent-state.tar.gz` before it launches the trial and removes it when the launch
 * returns, and Harbor writes the trial into `.jobs/<job>/<trial>/`, whose `result.json` comes
 * last. Until both are done, that evaluation keeps writing into the Benchmark's directory by path,
 * its trials and then its scoreboard. A trial whose process was killed leaves the same marks
 * behind until someone removes them.
 */
async function runningTrial(benchDir: string): Promise<string | null> {
  const jobsDir = path.join(benchDir, ".jobs");
  for (const job of await entriesOf(jobsDir)) {
    if (job.isFile() && job.name.endsWith(".agent-state.tar.gz")) return `.jobs/${job.name}`;
    if (!job.isDirectory()) continue;
    const jobDir = path.join(jobsDir, job.name);
    for (const trial of await entriesOf(jobDir)) {
      if (trial.isDirectory() && !(await occupied(path.join(jobDir, trial.name, "result.json")))) {
        return `.jobs/${job.name}/${trial.name}`;
      }
    }
  }
  return null;
}

/** The manifest's origin as the API carries it: camelCase, like every other DTO field. */
function originDto(origin: NonNullable<BenchmarkManifest["origin"]>): BenchmarkOrigin {
  return {
    kind: origin.kind,
    ...(origin.url !== undefined ? { url: origin.url } : {}),
    ...(origin.ref !== undefined ? { ref: origin.ref } : {}),
    ...(origin.path !== undefined ? { path: origin.path } : {}),
    ...(origin.imported_at !== undefined ? { importedAt: origin.imported_at } : {}),
  };
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function statementTitle(statement: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(statement)?.[1]?.trim();
  return heading?.replace(/^Case\s+\d+\s*:\s*/i, "") || fallback;
}

async function readStatementTitle(readme: string, fallback: string): Promise<string> {
  const handle = await fs.open(readme, "r");
  try {
    const buffer = Buffer.alloc(STATEMENT_TITLE_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return statementTitle(buffer.subarray(0, bytesRead).toString("utf8"), fallback);
  } finally {
    await handle.close();
  }
}

/** What the store reads through: where a Project's Benchmarks are, and the host's file reader. */
export interface BenchmarkStoreDeps {
  /** The Project's Benchmark folder (absolute). */
  dirOf(projectId: string): Promise<string>;
  files: CaseFiles;
}

export class BenchmarkStore {
  constructor(private readonly deps: BenchmarkStoreDeps) {}

  private dir(projectId: string): Promise<string> {
    return this.deps.dirOf(projectId);
  }

  async list(projectId: string): Promise<BenchmarksResponse> {
    const dir = await this.dir(projectId);
    let items: Array<{ name: string; isDir: boolean }>;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      items = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return { benchmarks: [], dir }; // Doesn't exist when unconfigured.
    }
    const benchmarks: BenchmarkSummary[] = [];
    for (const item of items.filter((i) => i.isDir).sort((a, b) => a.name.localeCompare(b.name))) {
      const benchDir = path.join(dir, item.name);
      // Only a manifest makes a directory a Benchmark — it is the file the evaluation Skills
      // require, and without it there is no title and no run count. A Benchmark deleted while an
      // evaluation is still running comes back as the paths that run keeps writing, manifest not
      // among them; that debris is not a Benchmark and is not listed, and neither is staging or
      // the Harbor checkouts, whose names are not ids. Absence of results is not absence of a
      // Benchmark: one that has never run has its manifest and lists as usual.
      const manifest = await this.manifestOf(benchDir);
      if (manifest === null) continue;
      benchmarks.push(await this.summarize(benchDir, item.name, manifest));
    }
    return { benchmarks, dir };
  }

  /**
   * One Benchmark as `list` gives it, or null when this server holds none by that id. Only a real
   * directory counts, as for `remove`: a symlink is not followed.
   */
  async get(projectId: string, benchmarkId: string): Promise<BenchmarkSummary | null> {
    const benchDir = path.join(await this.dir(projectId), benchmarkId);
    let isDirectory = false;
    try {
      isDirectory = (await fs.lstat(benchDir)).isDirectory();
    } catch {
      // Missing.
    }
    if (!isDirectory) return null;
    const manifest = await this.manifestOf(benchDir);
    return manifest === null ? null : this.summarize(benchDir, benchmarkId, manifest);
  }

  /**
   * Every id `create` refuses as taken, as names only: each entry of the Benchmark folder. Unlike
   * `list`, this includes a directory with no manifest (the debris of one deleted
   * mid-evaluation), and it reads no manifest and no scoreboard.
   */
  async takenIds(projectId: string): Promise<string[]> {
    try {
      return await fs.readdir(await this.dir(projectId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * Creates `<id>/` in the Benchmark folder, in the layout the evaluation Skills read: `benchmark_config.toml`
   * (id, title, description, runs, status `published`, the day's first version, origin `manual`),
   * `scoreboard.yaml` with an empty evaluations list, and per case `statement/README.md`
   * (`# <title>`, then the statement) and `rubric/README.md` (the rubric verbatim). An existing
   * directory is a 409, never merged into: a Benchmark's scores stay comparable only while its
   * cases are rewritten by nothing but the Skills. A half-written directory is removed again when
   * a later write fails.
   */
  async create(projectId: string, input: BenchmarkCreateInput): Promise<BenchmarkSummary> {
    const dir = await this.dir(projectId);
    const benchDir = path.join(dir, input.id);
    // The levels of an app's folders are this user's alone, as the workbench host makes them.
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      // A non-recursive mkdir is the existence check: it fails atomically on a directory
      // that is already there, so two creates of one id cannot both proceed.
      await fs.mkdir(benchDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw benchmarkExists(input.id);
      throw error;
    }
    const manifest: BenchmarkManifest = {
      id: input.id,
      title: input.title,
      ...(input.description !== undefined && input.description !== ""
        ? { description: input.description }
        : {}),
      version: nextDateVersion(),
      // A Benchmark made by hand is complete the moment it is submitted: its cases are written
      // and frozen, so nothing is left for a Skill to finish.
      status: "published",
      runs: input.runs,
      origin: { kind: "manual" },
    };
    try {
      await writeBenchmarkManifest(benchDir, manifest);
      await fs.writeFile(path.join(benchDir, SCOREBOARD_FILE), emptyScoreboard(), "utf8");
      for (const item of input.cases) {
        const caseDir = path.join(benchDir, item.id);
        await fs.mkdir(path.join(caseDir, "statement"), { recursive: true });
        await fs.mkdir(path.join(caseDir, "rubric"), { recursive: true });
        await fs.writeFile(
          path.join(caseDir, "statement", "README.md"),
          `# ${item.title.trim()}\n\n${item.statement.trim()}\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(caseDir, "rubric", "README.md"),
          `${item.rubric.trim()}\n`,
          "utf8",
        );
      }
    } catch (error) {
      await fs.rm(benchDir, { recursive: true, force: true });
      throw error;
    }
    return this.summarize(benchDir, input.id, manifest);
  }

  /**
   * Removes `<id>/` of the Benchmark folder whole — cases, config and scoreboard. Only a real directory
   * counts as existing: a symlink there is not followed, so nothing outside the Project's own
   * benchmarks directory can be deleted through this route.
   */
  async remove(projectId: string, benchmarkId: string): Promise<void> {
    const benchDir = path.join(await this.dir(projectId), benchmarkId);
    let isDirectory = false;
    try {
      isDirectory = (await fs.lstat(benchDir)).isDirectory();
    } catch {
      // Missing: reported below as not found.
    }
    if (!isDirectory) {
      throw new WorkbenchError(404, "not_found", `Benchmark does not exist: ${benchmarkId}`);
    }
    await fs.rm(benchDir, { recursive: true, force: true });
  }

  /**
   * Writes the package an uploaded zip holds as `<id>/` of the Benchmark folder (benchmark-archive.ts says what
   * is refused and why). What lands is the package as a new copy: its cases byte for byte; its
   * manifest, written with its id, with the origin rewritten to `zip` and the time of this import,
   * or to `git` with the repository folder `options.origin` names for a package fetched from one
   * (the version stays the package's, or none when it has none: it names the content, not the
   * copy); and a `scoreboard.yaml` with no
   * evaluations, since a package carries none. A taken id is a 409 unless `overwrite`, which
   * replaces the whole directory, its scoreboard and `.jobs/` included — except while an
   * evaluation of it is still running (`runningTrial`), which would go on writing its trials and
   * its scoreboard into the new copy: 409 `benchmark_busy`. The copy is staged and renamed into
   * place, so a failed write leaves the id as it was.
   */
  async importArchive(
    projectId: string,
    archive: Uint8Array,
    options: BenchmarkImportOptions,
  ): Promise<BenchmarkSummary> {
    const { manifest: packaged, caseFiles } = readBenchmarkArchive(archive);
    const dir = await this.dir(projectId);
    const benchDir = path.join(dir, packaged.id);
    // The levels of an app's folders are this user's alone, as the workbench host makes them.
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!options.overwrite && (await occupied(benchDir))) throw benchmarkExists(packaged.id);
    const running = options.overwrite ? await runningTrial(benchDir) : null;
    if (running !== null) {
      throw new WorkbenchError(
        409,
        "benchmark_busy",
        `Benchmark ${packaged.id} is being evaluated: ${running} marks a trial that has not finished, and the evaluation would go on writing into the new copy. Overwrite it once the evaluation ends.`,
      );
    }
    const importedAt = new Date().toISOString();
    const { origin } = options;
    const manifest: BenchmarkManifest = {
      ...packaged,
      origin:
        origin !== undefined
          ? {
              kind: "git",
              url: origin.url,
              ref: origin.ref,
              path: origin.path,
              imported_at: importedAt,
            }
          : { kind: "zip", imported_at: importedAt },
    };
    try {
      await placeBenchmark(
        dir,
        manifest.id,
        async (stage) => {
          for (const [rel, data] of caseFiles) {
            const file = path.join(stage, ...rel.split("/"));
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, data);
          }
          await writeBenchmarkManifest(stage, manifest);
          await fs.writeFile(path.join(stage, SCOREBOARD_FILE), emptyScoreboard(), "utf8");
        },
        { replace: options.overwrite },
      );
    } catch (error) {
      // Taken before this copy was renamed in: by another import of the same id after the check
      // above, or, under `overwrite`, by another process's copy (this process places one at a
      // time). Either way the id now holds someone else's copy, which the person may choose to
      // overwrite in turn.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") throw benchmarkExists(manifest.id);
      throw error;
    }
    return this.summarize(benchDir, manifest.id, manifest);
  }

  /**
   * The Benchmark's package as a zip for download (benchmark-archive.ts says what it holds), named
   * `<id>-v<version>.zip`, or `<id>.zip` when the manifest has no version. Only a published
   * Benchmark has one to give: a draft is still being written, a failed one never finished
   * calibrating, one whose manifest cannot be read has no manifest to give, and one whose manifest
   * is past the limits an import holds a package to (a hand-edited title, description or run
   * count) would not import anywhere (409, with the reason). As for `remove`, only a real
   * directory counts: a symlink is not followed.
   */
  async exportArchive(projectId: string, benchmarkId: string): Promise<BenchmarkArchive> {
    const benchDir = path.join(await this.dir(projectId), benchmarkId);
    let isDirectory = false;
    try {
      isDirectory = (await fs.lstat(benchDir)).isDirectory();
    } catch {
      // Missing: reported below as not found.
    }
    const manifest = isDirectory ? await this.manifestOf(benchDir) : null;
    if (manifest === null) {
      throw new WorkbenchError(404, "not_found", `Benchmark does not exist: ${benchmarkId}`);
    }
    if (manifest instanceof BenchmarkManifestError) {
      throw new WorkbenchError(
        409,
        manifest.code,
        `The Benchmark's manifest cannot be read, so it has no package to export: ${manifest.message}`,
      );
    }
    if (manifest.status !== "published") {
      throw new WorkbenchError(
        409,
        "benchmark_not_published",
        `Only a published Benchmark can be exported; ${benchmarkId} is ${manifest.status}.`,
      );
    }
    // The list reads a hand-edited manifest leniently; a package holds to what an import takes.
    try {
      checkBenchmarkManifest(manifest);
    } catch (error) {
      if (!(error instanceof BenchmarkManifestError)) throw error;
      throw new WorkbenchError(
        409,
        error.code,
        `The Benchmark's manifest is past what a package may hold, so no import would take it: ${error.message}`,
      );
    }
    return {
      // An id and a date version; a Benchmark whose manifest predates versions goes by its id.
      fileName:
        manifest.version !== undefined
          ? `${benchmarkId}-v${manifest.version}.zip`
          : `${benchmarkId}.zip`,
      data: await packBenchmark(benchDir, manifest),
    };
  }

  async listCases(
    projectId: string,
    benchmarkId: string,
    page?: number,
  ): Promise<BenchmarkCasesResponse> {
    const baseDir = await this.dir(projectId);
    const benchDir = path.join(baseDir, benchmarkId);
    const empty: BenchmarkCasesResponse =
      page === undefined ? { cases: [] } : { cases: [], total: 0 };
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    let realBaseDir: string;
    let realBenchDir: string;
    try {
      [entries, realBaseDir, realBenchDir] = await Promise.all([
        fs.readdir(benchDir, { withFileTypes: true }),
        fs.realpath(baseDir),
        fs.realpath(benchDir),
      ]);
    } catch {
      return empty;
    }
    if (!isWithin(realBaseDir, realBenchDir)) return empty;

    const ordered = entries
      .filter((item) => item.isDirectory() && item.name.startsWith("CASE-"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const cases: BenchmarkCaseSummary[] = [];
    for (const entry of page === undefined ? ordered : casePage(ordered, page)) {
      const fallback: BenchmarkCaseSummary = { id: entry.name, title: entry.name };
      try {
        const statementDir = await this.caseMaterialRoot(
          projectId,
          benchmarkId,
          entry.name,
          "statement",
        );
        const realReadme = await fs.realpath(path.join(statementDir, "README.md"));
        if (!isWithin(statementDir, realReadme)) throw new Error("README escapes Statement");
        cases.push({
          id: entry.name,
          title: await readStatementTitle(realReadme, entry.name),
        });
      } catch {
        cases.push(fallback);
      }
    }
    return page === undefined ? { cases } : { cases, total: ordered.length };
  }

  async listCaseFiles(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<CaseFilesResponse> {
    const materialRoot = await this.caseMaterialRoot(projectId, benchmarkId, caseId, material);
    return this.deps.files.list(materialRoot, rel);
  }

  async readCaseFile(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: { maxBytes?: number },
  ): Promise<CaseFileContent> {
    const materialRoot = await this.caseMaterialRoot(projectId, benchmarkId, caseId, material);
    return this.deps.files.read(materialRoot, rel, options);
  }

  private async caseMaterialRoot(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    material: CaseMaterial,
  ): Promise<string> {
    const baseDir = await this.dir(projectId);
    const benchDir = path.join(baseDir, benchmarkId);
    const caseDir = path.join(benchDir, caseId);
    const materialRoot = path.join(caseDir, material);
    try {
      const [realBaseDir, realBenchDir, realCaseDir, realMaterialRoot] = await Promise.all([
        fs.realpath(baseDir),
        fs.realpath(benchDir),
        fs.realpath(caseDir),
        fs.realpath(materialRoot),
      ]);
      // Every level stays where its name puts it: a Benchmark folder that links out of the
      // Project's Benchmark folder serves no files, as it lists no cases (listCases).
      if (
        !isWithin(realBaseDir, realBenchDir) ||
        !isWithin(realBenchDir, realCaseDir) ||
        path.dirname(realMaterialRoot) !== realCaseDir ||
        path.basename(realMaterialRoot) !== material
      ) {
        throw new Error("Case material is not canonical");
      }
      return realMaterialRoot;
    } catch {
      throw new WorkbenchError(404, "not_found", `Case ${material} does not exist.`);
    }
  }

  /**
   * The manifest of `benchDir`: null when the directory is not a Benchmark, the
   * BenchmarkManifestError when it is one whose manifest says something unusable — not TOML, an
   * `id` that is not its directory's, a `version` or an `[origin]` out of shape. Such a Benchmark
   * is listed as broken rather than hidden. Any other error (the file cannot be read at all) is
   * thrown.
   */
  private async manifestOf(
    benchDir: string,
  ): Promise<BenchmarkManifest | BenchmarkManifestError | null> {
    try {
      return await readBenchmarkManifest(benchDir);
    } catch (error) {
      if (error instanceof BenchmarkManifestError) return error;
      throw error;
    }
  }

  private async summarize(
    benchDir: string,
    id: string,
    manifest: BenchmarkManifest | BenchmarkManifestError,
  ): Promise<BenchmarkSummary> {
    // The manifest: title, description, per-case run count, build status, and the version and
    // origin when it has them (a file written before they existed has neither). The model isn't
    // part of it — each evaluation carries the Model actually used for that run. One that cannot
    // be read lists under the directory name as failed — unusable until the file is fixed — with
    // the reason, and neither a version nor an origin.
    const described: Pick<
      BenchmarkSummary,
      | "title"
      | "titleZh"
      | "description"
      | "descriptionZh"
      | "runs"
      | "status"
      | "version"
      | "origin"
      | "manifestError"
    > =
      manifest instanceof BenchmarkManifestError
        ? {
            title: id,
            status: "failed",
            manifestError: { code: manifest.code, message: manifest.message },
          }
        : {
            title: manifest.title,
            ...(manifest.titleZh !== undefined ? { titleZh: manifest.titleZh } : {}),
            ...(manifest.description !== undefined ? { description: manifest.description } : {}),
            ...(manifest.descriptionZh !== undefined
              ? { descriptionZh: manifest.descriptionZh }
              : {}),
            ...(manifest.runs !== undefined ? { runs: manifest.runs } : {}),
            status: manifest.status,
            ...(manifest.version !== undefined ? { version: manifest.version } : {}),
            ...(manifest.origin !== undefined ? { origin: originDto(manifest.origin) } : {}),
          };

    // scoreboard.yaml: evaluations[] is appended over time; bad entries are dropped one by one.
    let evaluations: BenchmarkEvaluation[] = [];
    try {
      evaluations = parseScoreboard(
        await fs.readFile(path.join(benchDir, SCOREBOARD_FILE), "utf8"),
      );
    } catch {
      // No scores yet.
    }

    // Case count: number of semantic Case subfolders.
    let caseCount = 0;
    try {
      const entries = await fs.readdir(benchDir, { withFileTypes: true });
      caseCount = entries.filter((e) => e.isDirectory() && e.name.startsWith("CASE-")).length;
    } catch {
      // Stays at 0.
    }

    return {
      id,
      dir: benchDir,
      ...described,
      caseCount,
      evaluations,
      // Which Agents this Benchmark has evaluated is a fact of its scoreboard, not of its
      // manifest: first-seen order, so the list reads in the order the Agents were tested.
      agentIds: [
        ...new Set(
          evaluations
            .map((evaluation) => evaluation.agentId)
            .filter((agentId): agentId is string => agentId !== null),
        ),
      ],
    };
  }
}
