/**
 * Benchmark packages as zips (src/server/archive.ts through the routes): importing one into the
 * workbench (`POST …/benchmarks/archive`) and exporting one from a Benchmark's page
 * (`GET …/benchmarks/:benchmarkId/archive`).
 *
 * Given Project p1 (owner alice, member bob; anyone else an outsider) whose Benchmark folder
 * starts empty:
 * - When a member imports a package, it lists with its cases, the package's version, an empty
 *   scoreboard and origin `zip`; its files land byte for byte and a dot-entry inside a case is left
 *   out. A package zipped at its root imports under the id its manifest declares; one whose
 *   manifest predates `id`, `version` and `origin` imports under its directory's name, unversioned,
 *   and its copy names the id from then on. A package fetched from a repository folder lists with
 *   that folder as its git origin; an origin that is not a git folder at a commit is refused. An
 *   outsider cannot import.
 * - When an import names a taken id, it is a 409 whose details name the id and changes nothing;
 *   with `overwrite` the directory is replaced whole, its evaluation records and `.jobs/` gone, but
 *   not while an evaluation of it is still running (a trial under `.jobs/` without its result, or
 *   the Test Agent's State packed for one): that is a 409 `benchmark_busy` that changes nothing
 *   until the evaluation ends. Overwrites of one id sent at once all land, one after another,
 *   leaving one whole copy; first imports of one id sent at once land once, the rest 409.
 * - When a Benchmark is exported, the zip carries `benchmark_config.toml` as the file reads and
 *   the cases, none of the copy's own state (scoreboard, `.jobs/`, dot-entries, links, stray
 *   files), and imports back as the same package with no scores. A Benchmark without a version
 *   exports as `<id>.zip`. Exporting an unchanged Benchmark again, later or in another time zone,
 *   gives the same bytes.
 * - When a zip is not a package, it is refused before anything is written: entries that climb
 *   out, absolute or backslashed paths, names holding a control character, names a disk that
 *   ignores letter case would take for one, a link, the copy's own state, anything else at the top
 *   level, a draft, a case without both READMEs, a directory named other than its id or by no id,
 *   a manifest at the root that names no id, one that is not TOML or is past the create form's
 *   limits, two top-level directories, bytes that are not a zip, an empty upload. One past the caps
 *   (over 14MB zipped, an entry declaring more than it may inflate to) is a
 *   413.
 * - When a Benchmark has no package to give (a draft or a failed one, a manifest that cannot be
 *   read or is past what an import takes), the export answers 409 with the reason; a missing one
 *   404; one holding a file past the caps 413; an outsider 404.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, type Zippable } from "fflate";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BenchmarkArchiveImportResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
} from "../../src/api.js";
import { entriesOf, exists, write } from "../helpers/files.js";
import { canCreateSymlink, createTestHost, type TestHost } from "../helpers/host.js";
import { switchTimeZone } from "../helpers/time-zone.js";
import { zipB64, zipB64Declaring } from "../helpers/zip.js";

const symlinks = await canCreateSymlink();

const base = "/api/projects/p1/benchmarks";

const SHA = "c12d65bc20beb5130ed57b3b7983c62d497b7d2f";
const FOLDER = `https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/${SHA}/packages/report-writing-v1`;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, string> };
}

async function errorOf(res: Response): Promise<ErrorBody["error"]> {
  return ((await res.json()) as ErrorBody).error;
}

/** A manifest as the package carries it; a key `over` sets to undefined is left out of the file. */
function manifest(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: "Report writing under conflicting sources",
    description: "Two cases: conflicting briefs, a strict format.",
    version: "2026.10.08.3",
    status: "published",
    runs: 2,
    origin: { kind: "builtin" },
    ...over,
  };
}

/** The cases of the package every scenario starts from, by path inside the Benchmark. */
const CASES: Record<string, string> = {
  "CASE-001-contradictions/task_config.toml":
    'id = "CASE-001-contradictions"\ntitle = "Two briefs"\ndescription = "Resolve conflicting briefs."\n',
  "CASE-001-contradictions/statement/README.md": "# Two briefs\n\nWrite the report.\n",
  "CASE-001-contradictions/statement/materials/brief-a.md": "Brief A says 3%.\n",
  "CASE-001-contradictions/rubric/README.md":
    "- 100 pts: names the conflict and takes the newer source.\n",
  "CASE-002-format/statement/README.md": "# A strict format\n\nTwo pages, cited.\n",
  "CASE-002-format/rubric/README.md": "- 100 pts: two pages, every claim cited.\n",
};

/** A package's zip entries under `dir/` (or at the root when `dir` is ""), the manifest's id `id`. */
function packageFiles(
  id: string,
  dir: string = id,
  over: Record<string, unknown> = {},
): Record<string, Uint8Array> {
  const at = (rel: string) => (dir === "" ? rel : `${dir}/${rel}`);
  const files: Record<string, Uint8Array> = {
    [at("benchmark_config.toml")]: strToU8(stringifyToml(manifest(id, over))),
  };
  for (const [rel, text] of Object.entries(CASES)) files[at(rel)] = strToU8(text);
  return files;
}

/** One evaluation, in the scoreboard shape the list reads. */
const SCOREBOARD = [
  "evaluations:",
  '  - time: "2026-10-08T10:00:00Z"',
  "    agent_id: default_agent",
  "    version: 1",
  "    provider: deepseek",
  "    model_id: deepseek-v4-pro",
  "    thinking_level: medium",
  "    score: 50",
  "    cost: null",
  "    duration_ms: 1000",
  "    cases:",
  "      - case: CASE-001-contradictions",
  "        score: 50",
  "        cost: null",
  "        duration_ms: 1000",
  "        runs:",
  "          - score: 50",
  "            cost: null",
  "            duration_ms: 1000",
  "            session_id: session-1",
  "",
].join("\n");

/** One evaluation cell's Harbor job under `.jobs/`, and the trial directory Harbor writes in it. */
const JOB = "CASE-001-contradictions-run1-20261008T100000Z";
const TRIAL = `${JOB}/report-writing-contradictions__a1B2c3D`;

describe("benchmark packages", () => {
  let host: TestHost;
  /** The Project's Benchmark folder on this server. */
  let dir: string;

  beforeEach(async () => {
    host = await createTestHost();
    dir = host.benchmarksDir("p1");
  });
  afterEach(async () => {
    await host.dispose();
  });

  const as = (user: string) => ({
    get: (url: string) => host.request("GET", url, { user }),
    post: (url: string, body: unknown) => host.request("POST", url, { user }, body),
  });
  const member = as("bob");
  const outsider = as("carol");

  /** This server's own list, as a hub asks for it. */
  const list = async () =>
    ((await (await member.get(`${base}?local=1`)).json()) as BenchmarksResponse).benchmarks;

  const importZip = (body: Record<string, unknown>) => member.post(`${base}/archive`, body);

  describe("import", () => {
    it("a member imports a package: it lists with its cases, its own version and no evaluations, from a zip", async () => {
      const metadata = {
        version: "0.1.0",
        title_zh: "报告写作",
        last_update: "2026-10-30T12:00:00Z",
        author: { name: "Prism-Shadow" },
      };
      const files = packageFiles("report-writing-v1", "report-writing-v1", metadata);
      // A dot-entry inside a case is no part of the package.
      files["report-writing-v1/CASE-001-contradictions/statement/.DS_Store"] = strToU8("x");
      const before = Date.now();

      const res = await importZip({ dataBase64: zipB64(files) });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark).toMatchObject({
        id: "report-writing-v1",
        title: "Report writing under conflicting sources",
        version: "0.1.0",
        status: "published",
        runs: 2,
        caseCount: 2,
        evaluations: [],
        origin: { kind: "zip" },
      });
      const importedAt = Date.parse(benchmark.origin!.importedAt!);
      expect(importedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(importedAt).toBeLessThanOrEqual(Date.now());
      expect((await list()).map((b) => b.id)).toEqual(["report-writing-v1"]);

      const benchDir = path.join(dir, "report-writing-v1");
      expect(
        parseToml(await fs.readFile(path.join(benchDir, "benchmark_config.toml"), "utf8")),
      ).toMatchObject(metadata);
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(benchDir, rel), "utf8"), rel).toBe(text);
      }
      expect(await exists(path.join(benchDir, "CASE-001-contradictions/statement/.DS_Store"))).toBe(
        false,
      );
      expect(parseYaml(await fs.readFile(path.join(benchDir, "scoreboard.yaml"), "utf8"))).toEqual({
        evaluations: [],
      });
      // Nothing left in staging.
      expect(await entriesOf(dir)).toEqual(["report-writing-v1"]);
    });

    it("a package zipped at its root imports under the id its manifest declares", async () => {
      const res = await importZip({ dataBase64: zipB64(packageFiles("report-writing-v1", "")) });

      expect(res.status).toBe(201);
      expect((await list()).map((b) => [b.id, b.caseCount])).toEqual([["report-writing-v1", 2]]);
    });

    it("imports 500 cases and reads only the requested page's statements", async () => {
      const files: Record<string, Uint8Array> = {
        "benchmark_config.toml": strToU8(stringifyToml(manifest("large"))),
      };
      for (let i = 1; i <= 500; i++) {
        const id = `CASE-${String(i).padStart(3, "0")}`;
        files[`${id}/statement/README.md`] = strToU8(`# Question ${i}`);
        files[`${id}/rubric/README.md`] = strToU8("One point.");
        files[`${id}/task_config.toml`] = strToU8(`id = "${id}"`);
      }
      expect((await importZip({ dataBase64: zipB64(files) })).status).toBe(201);
      const read = vi.spyOn(fs, "open");
      try {
        for (const page of [1, 2, 100]) {
          read.mockClear();
          const res = await member.get(`${base}/large/cases?page=${page}`);
          const { cases, total } = (await res.json()) as BenchmarkCasesResponse;
          expect(total).toBe(500);
          expect(cases.map((c) => c.title)).toEqual(
            Array.from({ length: 5 }, (_, i) => `Question ${(page - 1) * 5 + i + 1}`),
          );
          expect(read).toHaveBeenCalledTimes(5);
        }
      } finally {
        read.mockRestore();
      }
    });

    it("a package whose manifest predates id, version and origin imports under its directory's name, unversioned, and its copy names the id", async () => {
      const old = { id: undefined, version: undefined, origin: undefined };

      const res = await importZip({
        dataBase64: zipB64(packageFiles("report-writing-v1", "report-writing-v1", old)),
      });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark).toMatchObject({ id: "report-writing-v1", origin: { kind: "zip" } });
      expect(benchmark).not.toHaveProperty("version");
      const written = parseToml(
        await fs.readFile(path.join(dir, "report-writing-v1", "benchmark_config.toml"), "utf8"),
      );
      expect(written).toMatchObject({ id: "report-writing-v1", origin: { kind: "zip" } });
      expect(written).not.toHaveProperty("version");
    });

    it("a package fetched from a repository folder, named as its origin, lists with that git origin", async () => {
      const origin = { kind: "git", url: FOLDER, ref: SHA, path: "packages/report-writing-v1" };

      const res = await importZip({
        dataBase64: zipB64(packageFiles("report-writing-v1")),
        origin,
      });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark.origin).toMatchObject(origin);
      expect(Date.parse(benchmark.origin!.importedAt!)).not.toBeNaN();
      const onDisk = parseToml(
        await fs.readFile(path.join(dir, "report-writing-v1", "benchmark_config.toml"), "utf8"),
      ) as { origin: Record<string, string> };
      expect(onDisk.origin).toMatchObject(origin);
    });

    it.each([
      ["a kind other than git", { kind: "zip" }],
      ["a link that is not http(s)", { url: "javascript:alert(1)" }],
      ["a branch where the commit goes", { ref: "main" }],
      ["no folder", { path: "" }],
    ])("refuses an origin with %s, writing nothing", async (_what, over) => {
      const origin = { kind: "git", url: FOLDER, ref: SHA, path: "packages/x", ...over };

      const res = await importZip({
        dataBase64: zipB64(packageFiles("report-writing-v1")),
        origin,
      });

      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("bad_request");
      expect(await entriesOf(dir)).toEqual([]);
    });

    it("an outsider cannot import into the Project", async () => {
      const res = await outsider.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1")),
      });

      expect(res.status).toBe(404);
      expect(await entriesOf(dir)).toEqual([]);
    });

    it("a taken id is a 409 whose details name it; an overwrite replaces the directory whole, its evaluation records and .jobs/ included", async () => {
      const dataBase64 = zipB64(packageFiles("report-writing-v1"));
      expect((await importZip({ dataBase64 })).status).toBe(201);
      const benchDir = path.join(dir, "report-writing-v1");
      await write(benchDir, "scoreboard.yaml", SCOREBOARD);
      // A finished evaluation's trial: the job and its trial each hold their result.json.
      await write(benchDir, `.jobs/${JOB}/result.json`, "{}");
      await write(benchDir, `.jobs/${TRIAL}/result.json`, "{}");
      await write(benchDir, "CASE-003-old/statement/README.md", "# An older case\n");
      expect((await list())[0]!.evaluations).toHaveLength(1);

      const again = await importZip({ dataBase64 });

      expect(again.status).toBe(409);
      expect(await errorOf(again)).toMatchObject({
        code: "benchmark_exists",
        details: { benchmarkId: "report-writing-v1" },
      });
      expect((await list())[0]!.evaluations).toHaveLength(1);

      const replaced = await importZip({ dataBase64, overwrite: true });

      expect(replaced.status).toBe(201);
      expect((await list())[0]).toMatchObject({ caseCount: 2, evaluations: [] });
      expect(await exists(path.join(benchDir, ".jobs"))).toBe(false);
      expect(await exists(path.join(benchDir, "CASE-003-old"))).toBe(false);
      expect(await entriesOf(dir)).toEqual(["report-writing-v1"]);
    });

    /** What a running evaluation leaves under `.jobs/`, and what is there once it is done. */
    const runningEvaluations: Array<
      [string, (benchDir: string) => Promise<void>, (benchDir: string) => Promise<void>]
    > = [
      [
        "a trial that has no result yet",
        async (benchDir) => {
          await write(benchDir, `.jobs/${JOB}/config.json`, "{}");
          await write(benchDir, `.jobs/${TRIAL}/trial.log`, "running\n");
        },
        (benchDir) => write(benchDir, `.jobs/${TRIAL}/result.json`, "{}"),
      ],
      [
        "the Test Agent's State packed for a trial being launched",
        (benchDir) => write(benchDir, `.jobs/${JOB}.agent-state.tar.gz`, "state"),
        (benchDir) => fs.rm(path.join(benchDir, ".jobs", `${JOB}.agent-state.tar.gz`)),
      ],
    ];

    it.each(runningEvaluations)(
      "an overwrite while an evaluation runs (%s) is a 409 benchmark_busy that changes nothing, until the evaluation ends",
      async (_what, run, finish) => {
        const dataBase64 = zipB64(packageFiles("report-writing-v1"));
        expect((await importZip({ dataBase64 })).status).toBe(201);
        const benchDir = path.join(dir, "report-writing-v1");
        await write(benchDir, "scoreboard.yaml", SCOREBOARD);
        await run(benchDir);

        const refused = await importZip({ dataBase64, overwrite: true });

        expect(refused.status).toBe(409);
        expect((await errorOf(refused)).code).toBe("benchmark_busy");
        expect((await list())[0]!.evaluations).toHaveLength(1);
        expect(await exists(path.join(benchDir, ".jobs"))).toBe(true);

        await finish(benchDir);
        const replaced = await importZip({ dataBase64, overwrite: true });

        expect(replaced.status).toBe(201);
        expect((await list())[0]!.evaluations).toEqual([]);
      },
    );

    it("overwrites of one id sent at once all land, one after another, and leave one whole copy", async () => {
      const dataBase64 = zipB64(packageFiles("report-writing-v1"));
      expect((await importZip({ dataBase64 })).status).toBe(201);

      const answers = await Promise.all(
        Array.from({ length: 4 }, () => importZip({ dataBase64, overwrite: true })),
      );

      expect(answers.map((res) => res.status)).toEqual([201, 201, 201, 201]);
      // Nothing a replacement moved aside is left staged beside the copy.
      expect(await entriesOf(dir)).toEqual(["report-writing-v1"]);
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(dir, "report-writing-v1", rel), "utf8"), rel).toBe(text);
      }
    });

    it("first imports of one id sent at once: one lands, the others answer 409 benchmark_exists", async () => {
      const dataBase64 = zipB64(packageFiles("report-writing-v1"));

      const answers = await Promise.all(Array.from({ length: 3 }, () => importZip({ dataBase64 })));

      const refused = answers.filter((res) => res.status !== 201);
      expect(answers.length - refused.length).toBe(1);
      for (const res of refused) {
        expect(res.status).toBe(409);
        expect((await errorOf(res)).code).toBe("benchmark_exists");
      }
      expect(await entriesOf(dir)).toEqual(["report-writing-v1"]);
    });

    const withEntries = (extra: Zippable) =>
      zipB64({ ...packageFiles("report-writing-v1"), ...extra });
    const invalid = "benchmark_archive_invalid";

    const refusals: Array<[string, () => string, number, string]> = [
      [
        "an entry that climbs out of its case (zip-slip)",
        () =>
          withEntries({
            "report-writing-v1/CASE-001-contradictions/../../../escape.md": strToU8("x"),
          }),
        400,
        invalid,
      ],
      ["an absolute entry", () => withEntries({ "/escape.md": strToU8("x") }), 400, invalid],
      [
        "an entry with a backslash",
        () => withEntries({ "report-writing-v1\\escape.md": strToU8("x") }),
        400,
        invalid,
      ],
      [
        "an entry whose name holds a NUL",
        () =>
          withEntries({
            "report-writing-v1/CASE-001-contradictions/statement/notes\u0000.md": strToU8("x"),
          }),
        400,
        invalid,
      ],
      [
        "an entry whose name holds a control character",
        () =>
          withEntries({
            "report-writing-v1/CASE-001-contradictions/statement/\u001b[2Jnotes.md": strToU8("x"),
          }),
        400,
        invalid,
      ],
      [
        "two files whose names differ only in letter case",
        () =>
          withEntries({
            "report-writing-v1/CASE-001-contradictions/statement/readme.md": strToU8("x"),
          }),
        400,
        invalid,
      ],
      [
        "two cases whose names differ only in letter case",
        () =>
          withEntries({
            "report-writing-v1/CASE-002-FORMAT/statement/README.md": strToU8("# Again\n"),
            "report-writing-v1/CASE-002-FORMAT/rubric/README.md": strToU8("- 100 pts\n"),
          }),
        400,
        invalid,
      ],
      [
        "a file named, but for letter case, like a directory other entries need",
        () => withEntries({ "report-writing-v1/CASE-002-format/STATEMENT": strToU8("x") }),
        400,
        invalid,
      ],
      [
        "a symbolic link",
        () =>
          withEntries({
            "report-writing-v1/CASE-001-contradictions/statement/link.md": [
              strToU8("../../../../secret"),
              { os: 3, attrs: 0o120777 << 16 },
            ],
          }),
        400,
        invalid,
      ],
      [
        "the copy's scoreboard",
        () => withEntries({ "report-writing-v1/scoreboard.yaml": strToU8(SCOREBOARD) }),
        400,
        invalid,
      ],
      [
        "the copy's Harbor trials",
        () => withEntries({ "report-writing-v1/.jobs/trial-1/result.json": strToU8("{}") }),
        400,
        invalid,
      ],
      [
        "a file beside the cases",
        () => withEntries({ "report-writing-v1/notes.md": strToU8("scratch") }),
        400,
        invalid,
      ],
      [
        "a draft",
        () => zipB64(packageFiles("report-writing-v1", "report-writing-v1", { status: "draft" })),
        400,
        "benchmark_not_published",
      ],
      [
        "a case without its rubric",
        () => {
          const files = packageFiles("report-writing-v1");
          delete files["report-writing-v1/CASE-002-format/rubric/README.md"];
          return zipB64(files);
        },
        400,
        "benchmark_case_invalid",
      ],
      [
        "a package with no case",
        () =>
          zipB64({
            "report-writing-v1/benchmark_config.toml": strToU8(
              stringifyToml(manifest("report-writing-v1")),
            ),
          }),
        400,
        "benchmark_case_invalid",
      ],
      [
        "a directory named other than the manifest's id",
        () => zipB64(packageFiles("report-writing-v1", "renamed")),
        400,
        "benchmark_id_mismatch",
      ],
      [
        "a directory whose name is no id, around a manifest that names none",
        () => zipB64(packageFiles("report-writing-v1", "report writing (copy)", { id: undefined })),
        400,
        invalid,
      ],
      [
        "a manifest at the root that names no id",
        () => zipB64(packageFiles("report-writing-v1", "", { id: undefined })),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest that is not TOML",
        () =>
          withEntries({
            "report-writing-v1/benchmark_config.toml": strToU8('title = "unterminated\n'),
          }),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest past the create form's limits",
        () => zipB64(packageFiles("report-writing-v1", "report-writing-v1", { runs: 5000 })),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "two top-level directories",
        () => withEntries({ "other/README.md": strToU8("x") }),
        400,
        invalid,
      ],
      [
        "bytes that are not a zip",
        () => Buffer.from("not a zip at all").toString("base64"),
        400,
        invalid,
      ],
      ["an empty upload", () => "", 400, invalid],
      [
        "a zip over 14MB",
        () => Buffer.alloc(14 * 1024 * 1024 + 1).toString("base64"),
        413,
        "benchmark_too_large",
      ],
      [
        "base64 longer than any zip within 14MB encodes to",
        () => Buffer.alloc(14 * 1024 * 1024 + 4).toString("base64"),
        413,
        "benchmark_too_large",
      ],
      [
        "an entry declaring more than it may inflate to",
        () =>
          zipB64Declaring(packageFiles("report-writing-v1"), {
            "report-writing-v1/CASE-001-contradictions/statement/README.md": 512 * 1024 * 1024,
          }),
        413,
        "benchmark_too_large",
      ],
    ];

    it.each(refusals)("refuses %s, writing nothing", async (_what, data, status, code) => {
      const res = await importZip({ dataBase64: data() });

      expect(res.status).toBe(status);
      expect((await errorOf(res)).code).toBe(code);
      expect(await entriesOf(dir)).toEqual([]);
      // Where an entry that climbs out of the package would have landed.
      expect(await exists(path.join(path.dirname(dir), "escape.md"))).toBe(false);
      expect(await exists(path.join(host.root, "escape.md"))).toBe(false);
    });
  });

  describe("export", () => {
    /**
     * A published Benchmark on disk, as an Agent's import from the repository leaves one, with
     * this copy's own state beside its package.
     */
    async function seedBenchmark(over: Record<string, unknown> = {}): Promise<string> {
      const benchDir = path.join(dir, "report-writing-v1");
      const manifestText = stringifyToml(
        manifest("report-writing-v1", {
          origin: {
            kind: "git",
            url: FOLDER,
            ref: SHA,
            path: "packages/report-writing-v1",
            imported_at: "2026-10-08T09:00:00.000Z",
          },
          ...over,
        }),
      );
      await write(benchDir, "benchmark_config.toml", manifestText);
      for (const [rel, text] of Object.entries(CASES)) await write(benchDir, rel, text);
      await write(benchDir, "scoreboard.yaml", SCOREBOARD);
      await write(benchDir, ".jobs/trial-1/result.json", "{}");
      await write(benchDir, "CASE-001-contradictions/statement/.DS_Store", "x");
      await write(benchDir, "notes.md", "the builder's scratch\n");
      if (symlinks) {
        await fs.symlink(
          path.join(benchDir, "CASE-002-format", "rubric", "README.md"),
          path.join(benchDir, "CASE-001-contradictions", "statement", "rubric-link.md"),
        );
      }
      return manifestText;
    }

    it("carries the manifest as it reads and the cases, none of the copy's own state, and imports back as the same package with no scores", async () => {
      const manifestText = await seedBenchmark();

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''report-writing-v1-v2026.10.08.3.zip",
      );
      const zip = new Uint8Array(await res.arrayBuffer());
      const entries = unzipSync(zip);
      expect(Object.keys(entries).sort()).toEqual(
        ["benchmark_config.toml", ...Object.keys(CASES)]
          .map((rel) => `report-writing-v1/${rel}`)
          .sort(),
      );
      expect(strFromU8(entries["report-writing-v1/benchmark_config.toml"]!)).toBe(manifestText);

      // Back in, where the Benchmark no longer is.
      await fs.rm(path.join(dir, "report-writing-v1"), { recursive: true });
      const imported = await importZip({ dataBase64: Buffer.from(zip).toString("base64") });

      expect(imported.status).toBe(201);
      const benchDir = path.join(dir, "report-writing-v1");
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(benchDir, rel), "utf8"), rel).toBe(text);
      }
      expect(await entriesOf(benchDir)).toEqual([
        "CASE-001-contradictions",
        "CASE-002-format",
        "benchmark_config.toml",
        "scoreboard.yaml",
      ]);
      const [listed] = await list();
      expect(listed).toMatchObject({
        id: "report-writing-v1",
        title: "Report writing under conflicting sources",
        description: "Two cases: conflicting briefs, a strict format.",
        version: "2026.10.08.3",
        runs: 2,
        caseCount: 2,
        evaluations: [],
        origin: { kind: "zip" },
      });
      // The repository the first copy came from is not this copy's origin.
      expect(listed!.origin).not.toHaveProperty("url");
    });

    it("names the zip by the id alone for a Benchmark whose manifest predates versions, and it imports back", async () => {
      const benchDir = path.join(dir, "report-writing-v1");
      // As an earlier release's create form wrote it: no id, no version, no origin.
      const old = 'title = "Report writing"\nruns = 2\nstatus = "published"\n\n';
      await write(benchDir, "benchmark_config.toml", old);
      for (const [rel, text] of Object.entries(CASES)) await write(benchDir, rel, text);

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''report-writing-v1.zip",
      );
      const zip = new Uint8Array(await res.arrayBuffer());
      expect(strFromU8(unzipSync(zip)["report-writing-v1/benchmark_config.toml"]!)).toBe(old);
      await fs.rm(benchDir, { recursive: true });
      const imported = await importZip({ dataBase64: Buffer.from(zip).toString("base64") });
      expect(imported.status).toBe(201);
      expect((await list()).map((b) => [b.id, b.title, b.version])).toEqual([
        ["report-writing-v1", "Report writing", undefined],
      ]);
    });

    const unexportable: Array<[string, (benchDir: string) => Promise<void>, number, string]> = [
      ["a missing Benchmark", async () => {}, 404, "not_found"],
      [
        "a draft",
        async () => {
          await seedBenchmark({ status: "draft" });
        },
        409,
        "benchmark_not_published",
      ],
      [
        "a failed calibration",
        async () => {
          await seedBenchmark({ status: "failed" });
        },
        409,
        "benchmark_not_published",
      ],
      [
        "a manifest that is not TOML",
        async (benchDir) => {
          await seedBenchmark();
          await write(benchDir, "benchmark_config.toml", 'title = "unterminated\n');
        },
        409,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest naming another directory",
        async () => {
          await seedBenchmark({ id: "someone-else" });
        },
        409,
        "benchmark_id_mismatch",
      ],
      [
        "a hand-edited manifest past what an import takes",
        async () => {
          await seedBenchmark({ runs: 5000 });
        },
        409,
        "benchmark_manifest_invalid",
      ],
      [
        "a file over 5MB",
        async (benchDir) => {
          await seedBenchmark();
          await write(
            benchDir,
            "CASE-001-contradictions/statement/large.bin",
            new Uint8Array(5 * 1024 * 1024 + 1),
          );
        },
        413,
        "benchmark_too_large",
      ],
    ];

    it.each(unexportable)("has no package for %s", async (_what, arrange, status, code) => {
      await arrange(path.join(dir, "report-writing-v1"));

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(status);
      expect((await errorOf(res)).code).toBe(code);
    });

    it("an outsider cannot export", async () => {
      await seedBenchmark();

      expect((await outsider.get(`${base}/report-writing-v1/archive`)).status).toBe(404);
    });

    it("exports an unchanged Benchmark as the same bytes, whenever and in whatever time zone it is exported", async () => {
      await seedBenchmark();
      const exportAt = async (when: number): Promise<Buffer> => {
        vi.setSystemTime(when);
        const res = await member.get(`${base}/report-writing-v1/archive`);
        expect(res.status).toBe(200);
        return Buffer.from(await res.arrayBuffer());
      };
      const exportIn = async (zone: string, when: number): Promise<Buffer> => {
        const restoreZone = switchTimeZone(zone);
        try {
          return await exportAt(when);
        } finally {
          restoreZone();
        }
      };

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const now = Date.now();
        const first = await exportAt(now);
        const anHourLater = await exportAt(now + 61 * 60 * 1000);
        // Far west and far east of the zone the process started in (UTC-11, UTC+14).
        const farWest = await exportIn("Pacific/Pago_Pago", now);
        const farEast = await exportIn("Pacific/Kiritimati", now);

        expect(anHourLater.equals(first)).toBe(true);
        expect(farWest.equals(first)).toBe(true);
        expect(farEast.equals(first)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
