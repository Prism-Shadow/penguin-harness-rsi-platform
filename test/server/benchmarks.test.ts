/**
 * The Benchmark API on this server (src/server/routes.ts over src/server/service.ts), through the
 * fake host.
 *
 * Given Project p1 (owner alice, member bob; anyone else an outsider) whose Benchmark folder
 * starts empty:
 * - When a member lists the Benchmarks, each manifest's title, description, runs, status (literal
 *   draft and failed are themselves, anything else is published), version and origin are read; a
 *   Benchmark that never ran lists, while a directory without a manifest, a staging copy and the
 *   Harbor checkouts do not; an empty folder lists none and names itself. `?local=1`, as an older
 *   hub asks for it, is the same answer.
 * - When a manifest predates `id`, `version` and `origin`, the Benchmark lists as its file says
 *   and listing writes nothing; when it says something unusable, the Benchmark lists under its
 *   directory name as failed, with the reason; when the filesystem cannot read it, the request
 *   fails.
 * - When a scoreboard is read, its evaluations pass through as written (the Agent each tested,
 *   the model-written averages, the runs, a build number or a version label); legacy entries are
 *   neither migrated nor backfilled.
 * - When a member opens a Benchmark's cases, each lists under its statement's title and never its
 *   rubric; the statement's and the rubric's files are listed, previewed within a bound and
 *   downloaded, and an HTML or SVG file opens inert. A case folder or a statement folder that
 *   links anywhere but its own place has no files; a statement README that links out lists the
 *   case by its id; a Benchmark folder that links out lists no cases and serves no files.
 * - When a path names something that is not an id, it is not found, even where the path it spells
 *   leads to a real Benchmark.
 * - When the owner creates a Benchmark by hand, the server writes the layout the Skills read (a
 *   manifest with its id, the day's first version and origin manual); a malformed request, a
 *   member and an outsider write nothing. Only the owner deletes, and a Benchmark goes whole.
 * - An outsider is answered 404 throughout.
 *
 * The host's file reader keeps a path inside the folder it is given (links and `..` within a
 * case's files): that is the host's to test, and the fake keeps only its contract.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  BenchmarkCasesResponse,
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseFilesResponse,
} from "../../src/api.js";
import { entriesOf, exists, write } from "../helpers/files.js";
import { canCreateSymlink, createTestHost, type TestHost } from "../helpers/host.js";

// Symlink creation needs a privilege or Developer Mode on Windows; the cases that make links run
// wherever the capability exists.
const itWithSymlinks = it.skipIf(!(await canCreateSymlink()));

const base = "/api/projects/p1/benchmarks";

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, string> };
}

async function errorOf(res: Response): Promise<ErrorBody["error"]> {
  return ((await res.json()) as ErrorBody).error;
}

/** A benchmark_config.toml for the Benchmark in `dir`, as benchmark-design writes one now. */
async function writeManifest(dir: string, over: Record<string, unknown> = {}): Promise<void> {
  const manifest = {
    id: path.basename(dir),
    title: path.basename(dir),
    version: "2026.10.09.1",
    status: "published",
    runs: 1,
    origin: { kind: "agent" },
    ...over,
  };
  await write(dir, "benchmark_config.toml", stringifyToml(manifest));
}

/** A benchmark_config.toml written as `text`, the way earlier releases and people wrote them. */
async function writeRawManifest(dir: string, text: string): Promise<void> {
  await write(dir, "benchmark_config.toml", text);
}

/** Three evaluations: two Agents, model-written averages, and one recorded before agent_id. */
const SCOREBOARD = [
  "evaluations:",
  '  - time: "2026-07-16T10:00:00Z"',
  '    agent_id: "default_agent"',
  "    version: 3",
  '    provider: "deepseek"',
  '    model_id: "deepseek-v4-pro"',
  '    thinking_level: "medium"',
  '    summary_title: "Added planning steps to the system Prompt"',
  '    summary: "Each case run twice and averaged; added planning steps."',
  "    score: 72.35",
  "    cost: 0.04",
  "    duration_ms: 42500",
  "    cases:",
  // Stored averages are authoritative even when inconsistent with the raw runs.
  '      - case: "CASE-001-excel-task"',
  "        score: 80.2",
  "        cost: 0.04",
  "        duration_ms: 50000",
  "        runs:",
  "          - score: 80",
  "            cost: null",
  "            duration_ms: 48000",
  '            session_id: "session-run-1"',
  "          - score: 82",
  "            cost: 0.04",
  "            duration_ms: 52000",
  '            session_id: "session-run-2"',
  // All unknown run costs produce a model-written null case cost; the evaluation ignores it.
  '      - case: "CASE-002-web-task"',
  "        score: 64.5",
  "        cost: null",
  "        duration_ms: 35000",
  "        runs:",
  "          - score: 60",
  "            cost: null",
  "            duration_ms: 30000",
  '            session_id: "session-run-3"',
  "          - score: 70",
  "            cost: null",
  "            duration_ms: 40000",
  '            session_id: "session-run-4"',
  // A second Agent evaluated by the same Benchmark: one Benchmark measures as many Agents as it
  // is pointed at.
  '  - time: "2026-07-17T10:00:00Z"',
  '    agent_id: "report_writer"',
  "    version: 1",
  '    provider: "deepseek"',
  '    model_id: "deepseek-v4-pro"',
  '    thinking_level: "medium"',
  "    score: 55",
  "    cost: null",
  "    duration_ms: 30000",
  "    cases:",
  '      - case: "CASE-001-excel-task"',
  "        score: 55",
  "        cost: null",
  "        duration_ms: 30000",
  "        runs:",
  "          - score: 55",
  "            cost: null",
  "            duration_ms: 30000",
  '            session_id: "session-run-5"',
  // Recorded before evaluations named an Agent: still listed, just unlabelled.
  '  - time: "2026-07-18T10:00:00Z"',
  "    version: 1",
  '    provider: "deepseek"',
  '    model_id: "deepseek-v4-pro"',
  '    thinking_level: "medium"',
  "    score: 60",
  "    cost: null",
  "    duration_ms: 31000",
  "    cases:",
  '      - case: "CASE-001-excel-task"',
  "        score: 60",
  "        cost: null",
  "        duration_ms: 31000",
  "        runs:",
  "          - score: 60",
  "            cost: null",
  "            duration_ms: 31000",
  '            session_id: "session-run-6"',
].join("\n");

/** `swe-bench-v2` in `dir`: two cases with statement and rubric files, and the scoreboard above. */
async function writeSweBench(dir: string): Promise<void> {
  const bench = path.join(dir, "swe-bench-v2");
  const excel = "CASE-001-excel-task";
  await write(bench, `${excel}/statement/README.md`, "# Case 001: Excel cleanup\n\nClean it.");
  await write(bench, `${excel}/statement/data.csv`, "id,value\n1,alpha\n");
  await write(bench, `${excel}/statement/assets/notes.txt`, "public notes");
  await write(bench, `${excel}/statement/large.txt`, "x".repeat(300 * 1024));
  await write(
    bench,
    `${excel}/rubric/README.md`,
    "# Scoring rubric\n\n- Correct workbook: 100 pts",
  );
  await write(bench, `${excel}/rubric/expected.json`, '{"rows": 1}\n');
  await write(bench, "CASE-002-web-task/statement/README.md", "# Web task\n\nBuild the page.");
  await write(bench, "CASE-002-web-task/rubric/README.md", "PRIVATE GOLD: never return this");
  await writeManifest(bench, { title: "SWE Bench v2", description: "Example", runs: 2 });
  await write(bench, "scoreboard.yaml", SCOREBOARD);
}

/** A well-formed create request; the scenarios below vary one field at a time. */
const createBody: BenchmarkCreateRequest = {
  id: "report-writing-v1",
  title: "Report writing",
  description: "Hard cases for the report writer",
  runs: 2,
  cases: [
    {
      id: "CASE-001-contradictions",
      title: "Contradicting sources",
      statement: "Write a report from the two briefs in this Workspace.\n",
      rubric: "- 60 pts: names the contradiction.\n- 40 pts: picks the dated source.\n",
    },
    {
      id: "CASE-002-format",
      title: "Strict format",
      statement: "Follow the template exactly.",
      rubric: "- 100 pts: every template section present.",
    },
  ],
};

describe("benchmarks api", () => {
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
    delete: (url: string) => host.request("DELETE", url, { user }),
  });
  const owner = as("alice");
  const member = as("bob");
  const outsider = as("carol");

  /** This server's own list, as a hub asks for it. */
  const local = async (): Promise<BenchmarksResponse> =>
    (await (await member.get(`${base}?local=1`)).json()) as BenchmarksResponse;

  describe("the list", () => {
    it("an empty folder lists no Benchmarks, naming the folder a new one would go in", async () => {
      expect(await (await member.get(base)).json()).toEqual({ benchmarks: [], dir });
      expect(await local()).toEqual({ benchmarks: [], dir });
    });

    it("never lists a staging copy an interrupted write left, or the Harbor checkouts under .harbor/", async () => {
      // A write cut short leaves a whole Benchmark, manifest included, under staging.
      const staged = path.join(dir, ".seeding", "penguinharness-benchmark-sec-e-AbC123");
      await fs.mkdir(path.join(staged, "CASE-001-music-harmony", "statement"), { recursive: true });
      await writeManifest(staged, { id: "penguinharness-benchmark-sec-e" });
      // A Harbor checkout holds the benchmark repository's own benchmarks/ tree.
      await fs.mkdir(path.join(dir, ".harbor", "penguin-harness-benchmark-0123abc", "benchmarks"), {
        recursive: true,
      });
      await writeManifest(path.join(dir, "report-writing-v1"), { title: "Report writing" });

      expect((await local()).benchmarks.map((b) => b.id)).toEqual(["report-writing-v1"]);
    });

    it("a scoreboard's evaluations pass through as written: the Agent each tested, the model-written averages and the runs", async () => {
      await writeSweBench(dir);

      const bench = (await local()).benchmarks[0]!;

      expect(bench).toMatchObject({
        id: "swe-bench-v2",
        title: "SWE Bench v2",
        description: "Example",
        runs: 2,
        status: "published",
        version: "2026.10.09.1",
        origin: { kind: "agent" },
        caseCount: 2,
      });
      // The manifest carries no model reference: the model lives on each evaluation.
      expect("modelId" in bench).toBe(false);
      expect("provider" in bench).toBe(false);
      // The Agents a Benchmark has evaluated come from its scoreboard, in first-seen order; an
      // evaluation without an agent_id contributes none.
      expect(bench.agentIds).toEqual(["default_agent", "report_writer"]);
      expect(bench.evaluations[2]!.agentId).toBeNull();
      const evaluation = bench.evaluations[0]!;
      expect(evaluation).toMatchObject({
        agentId: "default_agent",
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        thinkingLevel: "medium",
        summaryTitle: "Added planning steps to the system Prompt",
        summary: "Each case run twice and averaged; added planning steps.",
        score: 72.35,
        cost: 0.04,
        durationMs: 42500,
      });
      expect("maxScore" in evaluation).toBe(false);
      // Per-case metrics trust the file (80.2, not the runs' arithmetic mean of 81).
      expect(evaluation.cases).toEqual([
        {
          case: "CASE-001-excel-task",
          score: 80.2,
          cost: 0.04,
          durationMs: 50000,
          runs: [
            { score: 80, cost: null, durationMs: 48000, sessionId: "session-run-1" },
            { score: 82, cost: 0.04, durationMs: 52000, sessionId: "session-run-2" },
          ],
        },
        {
          case: "CASE-002-web-task",
          score: 64.5,
          cost: null,
          durationMs: 35000,
          runs: [
            { score: 60, cost: null, durationMs: 30000, sessionId: "session-run-3" },
            { score: 70, cost: null, durationMs: 40000, sessionId: "session-run-4" },
          ],
        },
      ]);
    });

    it("answers a hub's `?local=1` read with the same list", async () => {
      await writeSweBench(dir);

      expect(await (await member.get(base)).json()).toEqual(await local());
    });

    it("does not migrate or backfill legacy scoreboard entries, and an outsider cannot list", async () => {
      const bench = path.join(dir, "swe-bench-v1");
      await fs.mkdir(path.join(bench, "CASE-001-excel-task", "statement"), { recursive: true });
      await writeRawManifest(bench, `title = "SWE Bench v1"\n`);
      await write(
        bench,
        "scoreboard.yaml",
        [
          "evaluations:",
          '  - time: "2026-07-16T10:00:00Z"',
          "    version: 1",
          "    score: 62.5",
          "    cost: 1.25",
          "    duration_ms: 60000",
          "    cases:",
          '      - case: "CASE-001-excel-task"',
          "        score: 30",
          "        cost: 0.5",
          "        duration_ms: 20000",
          '        session_id: "session-abc"',
          '      - case: ""', // Bad entry: discarded
          "        score: 1",
          "  - time: 42", // Bad evaluation: discarded
          "    score: 1",
        ].join("\n"),
      );

      const { benchmarks } = await local();

      expect(benchmarks.map((b) => b.id)).toEqual(["swe-bench-v1"]);
      expect(benchmarks[0]).toMatchObject({ title: "SWE Bench v1", caseCount: 1, evaluations: [] });
      expect("runs" in benchmarks[0]!).toBe(false);
      expect((await outsider.get(base)).status).toBe(404);
    });

    it("lists evaluations whose version is a version label (a semver string), not only build numbers", async () => {
      const bench = path.join(dir, "semver-bench");
      await fs.mkdir(path.join(bench, "CASE-001-excel-task", "statement"), { recursive: true });
      await writeRawManifest(bench, `title = "Semver bench"\n`);
      const evaluation = (time: string, version: string, sessionId: string) => [
        `  - time: "${time}"`,
        '    agent_id: "default_agent"',
        `    version: ${version}`,
        '    provider: "deepseek"',
        '    model_id: "deepseek-v4-pro"',
        '    thinking_level: "medium"',
        "    score: 72.35",
        "    cost: 0.04",
        "    duration_ms: 42500",
        "    cases:",
        '      - case: "CASE-001-excel-task"',
        "        score: 80.2",
        "        cost: 0.04",
        "        duration_ms: 50000",
        "        runs:",
        "          - score: 80",
        "            cost: 0.04",
        "            duration_ms: 48000",
        `            session_id: "${sessionId}"`,
      ];
      await write(
        bench,
        "scoreboard.yaml",
        [
          "evaluations:",
          // A build number, as on older scoreboards.
          ...evaluation("2026-07-16T10:00:00Z", "3", "session-run-1"),
          // A version label, as the Skills write it for a versioned Agent State.
          ...evaluation("2026-07-17T10:00:00Z", '"0.09"', "session-run-2"),
        ].join("\n"),
      );

      const listed = (await local()).benchmarks.find((b) => b.id === "semver-bench")!;

      // Both evaluations list: the build number and the label, each as written.
      expect(listed.evaluations.map((e) => e.version)).toEqual([3, "0.09"]);
    });

    it("lists a Benchmark that has never run, but not a directory without a manifest", async () => {
      // Deleted mid-evaluation: the run kept writing, so the directory is back with a case and a
      // scoreboard but no manifest. Not a Benchmark.
      await write(
        dir,
        "half-deleted/CASE-001-excel-task/statement/README.md",
        "# Case 001: Excel cleanup\n",
      );
      await write(dir, "half-deleted/scoreboard.yaml", "evaluations: []\n");
      // Created and never evaluated: a manifest, cases, and no scoreboard at all. Having no scores
      // yet is not being incomplete.
      await fs.mkdir(path.join(dir, "never-run", "CASE-001-report", "statement"), {
        recursive: true,
      });
      await writeManifest(path.join(dir, "never-run"), { title: "Report writing", runs: 2 });

      const { benchmarks } = await local();

      expect(benchmarks.map((b) => b.id)).toEqual(["never-run"]);
      expect(benchmarks[0]).toMatchObject({
        title: "Report writing",
        runs: 2,
        caseCount: 1,
        evaluations: [],
      });
    });

    it("reads status from the manifest: literal draft and failed are themselves, everything else is published", async () => {
      // Still being written by benchmark-design: not usable yet.
      await writeManifest(path.join(dir, "draft-bench"), { status: "draft" });
      // Calibration never produced a result to freeze: unusable.
      await writeManifest(path.join(dir, "failed-bench"), { status: "failed" });
      // Written before the key existed: no status at all is not a lock.
      await writeRawManifest(path.join(dir, "legacy-bench"), 'title = "Legacy"\nruns = 1\n');
      // Neither is a value nobody defined.
      await writeRawManifest(
        path.join(dir, "unknown-bench"),
        'title = "Unknown"\nruns = 1\nstatus = "someday"\n',
      );

      expect((await local()).benchmarks.map((b) => [b.id, b.status])).toEqual([
        ["draft-bench", "draft"],
        ["failed-bench", "failed"],
        ["legacy-bench", "published"],
        ["unknown-bench", "published"],
      ]);
    });

    it("lists a Benchmark whose manifest predates id, version and origin as its file says, unversioned and of unknown origin, and writes nothing", async () => {
      const bench = path.join(dir, "report-writing-v1");
      await fs.mkdir(path.join(bench, "CASE-001-report", "statement"), { recursive: true });
      // As an earlier release's create form wrote it.
      const toml =
        'title = "Report writing"\ndescription = "Old"\nruns = 2\nstatus = "published"\n\n';
      await writeRawManifest(bench, toml);

      const first = await local();

      expect(first.benchmarks).toEqual([
        {
          id: "report-writing-v1",
          dir: bench,
          title: "Report writing",
          description: "Old",
          runs: 2,
          status: "published",
          caseCount: 1,
          evaluations: [],
          agentIds: [],
        },
      ]);
      expect(await fs.readFile(path.join(bench, "benchmark_config.toml"), "utf8")).toBe(toml);
      expect(await entriesOf(bench)).toEqual(["CASE-001-report", "benchmark_config.toml"]);
      expect((await local()).benchmarks).toEqual(first.benchmarks);
    });

    it("lists a Benchmark whose manifest cannot be used as failed, saying why, never as usable", async () => {
      await writeRawManifest(path.join(dir, "broken-toml"), 'title = "Broken\n');
      // Copied from another Benchmark's folder: the manifest names the original.
      await writeManifest(path.join(dir, "copied-bench"), {
        id: "report-writing-v1",
        title: "Copy",
      });
      // An import that recorded a branch, which moves, where its commit belongs.
      await writeManifest(path.join(dir, "moving-bench"), {
        title: "Moving",
        origin: { kind: "git", url: "https://github.com/o/r/tree/main/x", ref: "main" },
      });

      const { benchmarks } = await local();

      expect(
        benchmarks.map((b) => [b.id, b.title, b.status, b.version, b.manifestError?.code]),
      ).toEqual([
        ["broken-toml", "broken-toml", "failed", undefined, "benchmark_manifest_invalid"],
        ["copied-bench", "copied-bench", "failed", undefined, "benchmark_id_mismatch"],
        ["moving-bench", "moving-bench", "failed", undefined, "benchmark_manifest_invalid"],
      ]);
      // The reason names what is wrong, for the person who has to fix the file.
      expect(benchmarks[1]!.manifestError?.message).toContain("report-writing-v1");
      expect(benchmarks[2]!.manifestError?.message).toContain("origin.ref");
    });

    it("fails the request when a manifest cannot be read from disk at all, rather than listing it as healthy", async () => {
      // A directory where the file should be: no content to judge, only a filesystem error.
      await fs.mkdir(path.join(dir, "odd-bench", "benchmark_config.toml"), { recursive: true });
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect((await member.get(base)).status).toBe(500);
      } finally {
        quiet.mockRestore();
      }
    });
  });

  describe("cases", () => {
    it("a case lists under its statement's title, never its rubric's text, with or without `?local=1`", async () => {
      await writeSweBench(dir);

      const own = (await (
        await member.get(`${base}/swe-bench-v2/cases?local=1`)
      ).json()) as BenchmarkCasesResponse;
      const page = (await (
        await member.get(`${base}/swe-bench-v2/cases`)
      ).json()) as BenchmarkCasesResponse;

      expect(own).toEqual({
        cases: [
          { id: "CASE-001-excel-task", title: "Excel cleanup" },
          { id: "CASE-002-web-task", title: "Web task" },
        ],
      });
      expect(page).toEqual(own);
      expect(JSON.stringify([own, page])).not.toContain("PRIVATE GOLD");
    });

    it("a member browses a case's statement and rubric files: listed, previewed within a bound, downloaded; an outsider cannot", async () => {
      await writeSweBench(dir);
      const filesBase = `${base}/swe-bench-v2/cases/CASE-001-excel-task/files`;
      const rubricBase = `${base}/swe-bench-v2/cases/CASE-001-excel-task/rubric/files`;
      const listing = async (url: string) => {
        const body = (await (await member.get(url)).json()) as CaseFilesResponse;
        return { path: body.path, entries: body.entries.map((e) => `${e.kind}:${e.name}`).sort() };
      };

      expect(await listing(filesBase)).toEqual({
        path: "",
        entries: ["dir:assets", "file:README.md", "file:data.csv", "file:large.txt"],
      });
      expect((await listing(`${filesBase}?path=assets`)).entries).toEqual(["file:notes.txt"]);
      expect((await listing(rubricBase)).entries).toEqual(["file:README.md", "file:expected.json"]);

      const statement = await member.get(`${filesBase}/content?path=README.md&preview=1`);
      expect(statement.status).toBe(200);
      expect(statement.headers.get("content-type")).toContain("markdown");
      expect(await statement.text()).toBe("# Case 001: Excel cleanup\n\nClean it.");
      const rubric = await member.get(`${rubricBase}/content?path=README.md&preview=1`);
      expect(rubric.status).toBe(200);
      expect(await rubric.text()).toContain("Correct workbook: 100 pts");

      const large = await member.get(`${filesBase}/content?path=large.txt&preview=1`);
      expect(large.status).toBe(200);
      expect(large.headers.get("x-content-truncated")).toBe("1");
      expect((await large.text()).length).toBe(256 * 1024);

      const download = await member.get(`${filesBase}/content?path=data.csv&download=1`);
      expect(download.headers.get("content-disposition")).toContain("attachment");
      expect(await download.text()).toBe("id,value\n1,alpha\n");

      expect((await outsider.get(`${base}/swe-bench-v2/cases`)).status).toBe(404);
      expect((await outsider.get(filesBase)).status).toBe(404);
      expect((await outsider.get(`${filesBase}/content?path=README.md`)).status).toBe(404);
    });

    it("an HTML statement file opens as text and an SVG one sandboxed; a download keeps their own types", async () => {
      const bench = path.join(dir, "web-bench");
      await writeManifest(bench);
      await write(bench, "CASE-001-page/statement/README.md", "# A page\n");
      await write(bench, "CASE-001-page/statement/page.html", "<script>alert(1)</script>");
      await write(
        bench,
        "CASE-001-page/statement/logo.svg",
        "<svg><script>alert(1)</script></svg>",
      );
      const content = `${base}/web-bench/cases/CASE-001-page/files/content`;

      const html = await member.get(`${content}?path=page.html`);
      const svg = await member.get(`${content}?path=logo.svg`);
      const htmlDownload = await member.get(`${content}?path=page.html&download=1`);
      const svgDownload = await member.get(`${content}?path=logo.svg&download=1`);

      expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(html.headers.get("x-content-type-options")).toBe("nosniff");
      expect(svg.headers.get("content-type")).toContain("image/svg+xml");
      expect(svg.headers.get("content-security-policy")).toBe("sandbox");
      expect(htmlDownload.headers.get("content-type")).toContain("text/html");
      expect(htmlDownload.headers.get("content-disposition")).toContain("attachment");
      expect(svgDownload.headers.get("content-security-policy")).toBeNull();
    });

    itWithSymlinks(
      "a case folder, or a statement folder, that links anywhere but its own place has no files to browse",
      async () => {
        const bench = path.join(dir, "linked");
        await writeManifest(bench);
        await write(bench, "CASE-001-own/statement/README.md", "# Own\n");
        await write(bench, "CASE-001-own/rubric/README.md", "OWN RUBRIC\n");
        // A case folder that is a link to a case outside the Benchmark.
        const outside = path.join(host.root, "elsewhere", "CASE-002-out");
        await write(outside, "statement/README.md", "OUTSIDE\n");
        await write(outside, "rubric/README.md", "OUTSIDE\n");
        await fs.symlink(outside, path.join(bench, "CASE-002-out"), "dir");
        // A statement folder that is a link to the case's own rubric.
        await write(bench, "CASE-003-swapped/rubric/README.md", "SWAPPED RUBRIC\n");
        await fs.symlink(
          path.join(bench, "CASE-003-swapped", "rubric"),
          path.join(bench, "CASE-003-swapped", "statement"),
          "dir",
        );
        // A statement folder that is a link to another case's statement.
        await write(bench, "CASE-004-borrowed/rubric/README.md", "- 100 pts\n");
        await fs.symlink(
          path.join(bench, "CASE-001-own", "statement"),
          path.join(bench, "CASE-004-borrowed", "statement"),
          "dir",
        );
        const files = (caseId: string, material = "files") =>
          `${base}/linked/cases/${caseId}/${material}`;

        for (const url of [
          files("CASE-002-out"),
          files("CASE-002-out", "rubric/files"),
          files("CASE-003-swapped"),
          files("CASE-004-borrowed"),
        ]) {
          const listed = await member.get(url);
          expect(listed.status, url).toBe(404);
          const read = await member.get(`${url}/content?path=README.md`);
          expect(read.status, url).toBe(404);
          expect(await read.text()).not.toMatch(/OUTSIDE|SWAPPED|Own/);
        }
        // What is in its own place still opens.
        expect((await member.get(`${files("CASE-001-own")}/content?path=README.md`)).status).toBe(
          200,
        );
        expect(
          (await member.get(`${files("CASE-003-swapped", "rubric/files")}/content?path=README.md`))
            .status,
        ).toBe(200);
      },
    );

    itWithSymlinks(
      "a statement README that links out of its statement lists the case by its id, and a Benchmark folder that links out of the Project's lists no cases and serves no files",
      async () => {
        const peek = path.join(dir, "peek");
        await writeManifest(peek);
        await write(peek, "CASE-001-peek/rubric/README.md", "# PRIVATE GOLD\n");
        await fs.mkdir(path.join(peek, "CASE-001-peek", "statement"), { recursive: true });
        await fs.symlink(
          path.join(peek, "CASE-001-peek", "rubric", "README.md"),
          path.join(peek, "CASE-001-peek", "statement", "README.md"),
        );
        const elsewhere = path.join(host.root, "elsewhere", "borrowed");
        await writeManifest(elsewhere);
        await write(elsewhere, "CASE-001-x/statement/README.md", "# Elsewhere\n");
        await fs.symlink(elsewhere, path.join(dir, "borrowed"), "dir");

        const peeked = await (await member.get(`${base}/peek/cases?local=1`)).json();
        const borrowed = await (await member.get(`${base}/borrowed/cases?local=1`)).json();

        expect(peeked).toEqual({ cases: [{ id: "CASE-001-peek", title: "CASE-001-peek" }] });
        expect(borrowed).toEqual({ cases: [] });
        const listing = await member.get(`${base}/borrowed/cases/CASE-001-x/files`);
        const content = await member.get(
          `${base}/borrowed/cases/CASE-001-x/files/content?path=README.md`,
        );
        expect([listing.status, content.status]).toEqual([404, 404]);
      },
    );

    it("a path naming something that is not an id is not found, even where the path it spells leads to a real Benchmark", async () => {
      const bench = path.join(dir, "real");
      await writeManifest(bench);
      await write(bench, "CASE-001-a/statement/README.md", "# A\n");
      await write(bench, "CASE-001-a/rubric/README.md", "- 100 pts\n");
      // Each decodes to a path that, joined to the folder, is `real` or its case.
      const spelled = "other%2F..%2Freal";
      const caseSpelled = "CASE-x%2F..%2FCASE-001-a";
      expect((await member.get(`${base}/real/cases/CASE-001-a/files`)).status).toBe(200);

      for (const [method, url, user] of [
        ["GET", `${base}/${spelled}/cases`, "bob"],
        ["GET", `${base}/${spelled}/archive`, "bob"],
        ["GET", `${base}/real/cases/${caseSpelled}/files`, "bob"],
        ["GET", `${base}/real/cases/${caseSpelled}/rubric/files/content?path=README.md`, "bob"],
        ["DELETE", `${base}/${spelled}`, "alice"],
      ] as const) {
        const res = await host.request(method, url, { user });
        expect(res.status, url).toBe(404);
        expect((await errorOf(res)).code, url).toBe("not_found");
      }
      expect(await exists(path.join(bench, "CASE-001-a", "statement", "README.md"))).toBe(true);
    });
  });

  describe("create and delete", () => {
    it("the owner creates a Benchmark by hand and the server writes the layout the Skills read", async () => {
      // A Benchmark made on a day is that day's first revision.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 9, 12));
      const res = await owner.post(base, createBody).finally(() => vi.useRealTimers());

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkCreateResponse;
      const bench = path.join(dir, "report-writing-v1");
      expect(benchmark).toEqual({
        id: "report-writing-v1",
        dir: bench,
        title: "Report writing",
        description: "Hard cases for the report writer",
        runs: 2,
        status: "published",
        version: "2026.10.09.1",
        origin: { kind: "manual" },
        caseCount: 2,
        evaluations: [],
        // A Benchmark names no Agent of its own: it has evaluated none until it is run.
        agentIds: [],
      });
      expect(
        parseToml(await fs.readFile(path.join(bench, "benchmark_config.toml"), "utf8")),
      ).toEqual({
        id: "report-writing-v1",
        title: "Report writing",
        description: "Hard cases for the report writer",
        version: "2026.10.09.1",
        status: "published",
        runs: 2,
        origin: { kind: "manual" },
      });
      expect(await fs.readFile(path.join(bench, "scoreboard.yaml"), "utf8")).toBe(
        "evaluations: []\n",
      );
      // The statement README opens with the title as its heading (what the case list reads back);
      // the rubric is written verbatim, trimmed to one trailing newline.
      expect(
        await fs.readFile(
          path.join(bench, "CASE-001-contradictions", "statement", "README.md"),
          "utf8",
        ),
      ).toBe("# Contradicting sources\n\nWrite a report from the two briefs in this Workspace.\n");
      expect(
        await fs.readFile(
          path.join(bench, "CASE-001-contradictions", "rubric", "README.md"),
          "utf8",
        ),
      ).toBe("- 60 pts: names the contradiction.\n- 40 pts: picks the dated source.\n");
      expect((await local()).benchmarks).toEqual([benchmark]);
      const cases = (await (
        await member.get(`${base}/report-writing-v1/cases?local=1`)
      ).json()) as BenchmarkCasesResponse;
      expect(cases.cases).toEqual([
        { id: "CASE-001-contradictions", title: "Contradicting sources" },
        { id: "CASE-002-format", title: "Strict format" },
      ]);

      // The same id again is a conflict naming the id, and the first Benchmark is left as it was.
      const again = await owner.post(base, { ...createBody, title: "Overwrite attempt" });
      expect(again.status).toBe(409);
      expect(await errorOf(again)).toMatchObject({
        code: "benchmark_exists",
        details: { benchmarkId: "report-writing-v1" },
      });
      expect(
        parseToml(await fs.readFile(path.join(bench, "benchmark_config.toml"), "utf8")),
      ).toMatchObject({ title: "Report writing" });
    });

    it("rejects malformed create requests, members and outsiders without writing anything", async () => {
      const first = createBody.cases[0]!;
      const bad: unknown[] = [
        { ...createBody, id: "../escape" },
        { ...createBody, id: "" },
        { ...createBody, title: "   " },
        { ...createBody, runs: 0 },
        { ...createBody, runs: 1.5 },
        { ...createBody, runs: 1001 },
        { ...createBody, cases: [] },
        { ...createBody, cases: [{ ...first, id: "excel-task" }] },
        { ...createBody, cases: [{ ...first, id: "CASE-001/../x" }] },
        { ...createBody, cases: [first, first] },
        { ...createBody, cases: [{ ...first, rubric: "" }] },
      ];
      for (const body of bad) {
        const res = await owner.post(base, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect((await errorOf(res)).code).toBe("bad_request");
      }
      expect((await member.post(base, createBody)).status).toBe(403);
      expect((await outsider.post(base, createBody)).status).toBe(404);
      // A missing Project is a 404 before any validation.
      expect((await owner.post("/api/projects/nobody/benchmarks", createBody)).status).toBe(404);
      expect(await entriesOf(dir)).toEqual([]);
    });

    it("the owner deletes a Benchmark directory whole; members and outsiders cannot", async () => {
      expect((await owner.post(base, createBody)).status).toBe(201);
      const bench = path.join(dir, "report-writing-v1");
      expect((await member.delete(`${base}/report-writing-v1`)).status).toBe(403);
      expect((await outsider.delete(`${base}/report-writing-v1`)).status).toBe(404);
      expect(await exists(bench)).toBe(true);

      expect((await owner.delete(`${base}/report-writing-v1`)).status).toBe(204);

      expect(await exists(bench)).toBe(false);
      expect((await local()).benchmarks).toEqual([]);
      // Gone, or never there: both are a plain 404.
      expect((await owner.delete(`${base}/report-writing-v1`)).status).toBe(404);
      expect((await owner.delete(`${base}/never-existed`)).status).toBe(404);
    });
  });
});
