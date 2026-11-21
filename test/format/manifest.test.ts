/**
 * A Benchmark's manifest, benchmark_config.toml (src/format/manifest.ts), and the dated versions
 * its revisions carry (src/format/dates.ts).
 *
 * Given a Benchmark directory in a temp folder:
 * - When a manifest is written, it reads back as written, and the file is plain TOML: the keys an
 *   older release reads (title, description, runs, status) top-level, `id` and `version` beside
 *   them, the `[origin]` table last; a package's metadata (Chinese title, update time, author,
 *   references) survives a save and a read.
 * - When a manifest from before `id`, `version` and `[origin]` is read, it reads as it always did
 *   (its directory's id, unversioned, of unknown origin) and is left as it is; the older keys keep
 *   their lenient reading (no title is the directory name, a status that is neither draft nor
 *   failed is published, a run count that is not a positive integer is left out), and a key the
 *   manifest does not know is ignored.
 * - When the directory has no manifest, or its name is not an id (`.seeding/`), it is not a
 *   Benchmark.
 * - When the new keys are out of shape, the read is refused with a code naming the rule (an `id`
 *   other than the directory's is `benchmark_id_mismatch`, the rest and text that is not TOML
 *   `benchmark_manifest_invalid`), in one line that names what is wrong.
 * - When an origin's `imported_at` is a TOML date-time, it reads as its ISO 8601 text.
 * - When a manifest is past what a written one keeps, it is never written.
 * - When a revision is versioned, it is the day's `.1`; another the same day takes the next number
 *   (`.10` after `.9`); a later day starts again at `.1`; a version never goes backwards; a
 *   previous version that does not parse counts for nothing. Versions order by date, then by
 *   number, and the legacy spelling is the same version.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BenchmarkManifestError,
  compareDateVersions,
  nextDateVersion,
  readBenchmarkManifest,
  writeBenchmarkManifest,
  type BenchmarkManifest,
} from "../../src/format/index.js";
import { tempRoot } from "../helpers/host.js";

let tmp: string;

beforeEach(async () => {
  tmp = await tempRoot("rsi-manifest-");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A Benchmark directory under the temp root, created empty. */
async function benchDir(id: string): Promise<string> {
  const dir = path.join(tmp, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const manifest = (over: Partial<BenchmarkManifest> = {}): BenchmarkManifest => ({
  id: "report-writing-v1",
  title: "Report writing",
  description: "Hard cases for the report writer",
  version: "2026.10.09.1",
  status: "published",
  runs: 2,
  origin: { kind: "manual" },
  ...over,
});

/** Writes `toml` as the directory's manifest, raw: what an Agent or a person may have put there. */
async function writeRaw(dir: string, toml: string): Promise<void> {
  await fs.writeFile(path.join(dir, "benchmark_config.toml"), toml);
}

async function readRaw(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8");
}

/** The error reading `dir`'s manifest throws, or the manifest when it does not throw. */
async function refusal(dir: string): Promise<unknown> {
  return readBenchmarkManifest(dir).catch((e: unknown) => e);
}

describe("benchmark_config.toml", () => {
  it("a manifest written is read back as written, and an older reader finds its keys where they always were", async () => {
    const dir = await benchDir("report-writing-v1");
    const written = manifest({
      origin: {
        kind: "git",
        url: "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/x",
        ref: "c12d65bc20beb5130ed57b3b7983c62d497b7d2f",
        path: "packages/x",
        imported_at: "2026-10-09T08:00:00.000Z",
      },
    });

    await writeBenchmarkManifest(dir, written);

    expect(await readBenchmarkManifest(dir)).toEqual(written);
    // Plain TOML: title, description, runs and status are top-level, as a reader from before the
    // new keys expects, and the origin is a table of its own that holds nothing else.
    expect(parseToml(await readRaw(dir))).toEqual(written);
  });

  it("a package's metadata survives a save and a read", async () => {
    const dir = await benchDir("report-writing-v1");
    const written = manifest({
      version: "0.1.0",
      titleZh: "报告写作",
      lastUpdate: "2026-10-30T12:00:00Z",
      author: { name: "Prism-Shadow", homepage: "https://github.com/Prism-Shadow" },
      references: [
        "https://papers.example.com/abs/2608.03764",
        "https://github.com/Prism-Shadow/GDPevo",
      ],
    });

    await writeBenchmarkManifest(dir, written);

    expect(await readBenchmarkManifest(dir)).toEqual(written);
    const { titleZh, lastUpdate, ...rest } = written;
    expect(parseToml(await readRaw(dir))).toEqual({
      ...rest,
      title_zh: titleZh,
      last_update: lastUpdate,
    });
  });

  it("a manifest from before id, version and origin reads as it always did, and is left as it is", async () => {
    const dir = await benchDir("swe-bench-v1");
    // What earlier releases' seeding, the create form and benchmark-design wrote.
    const old =
      'title = "SWE Bench v1"\ndescription = "Hard cases"\nruns = 2\nstatus = "published"\n\n';
    await writeRaw(dir, old);

    expect(await readBenchmarkManifest(dir)).toEqual({
      id: "swe-bench-v1",
      title: "SWE Bench v1",
      description: "Hard cases",
      status: "published",
      runs: 2,
    });
    expect(await readRaw(dir)).toBe(old);
    expect(await fs.readdir(dir)).toEqual(["benchmark_config.toml"]);
  });

  it("the older keys are read as leniently as ever: no title is the directory name, no status or an unknown one is published, a bad run count is left out", async () => {
    const bare = await benchDir("bare-bench");
    await writeRaw(bare, 'description = "Old"\n');
    const odd = await benchDir("odd-bench");
    await writeRaw(odd, 'title = ""\nruns = 0\nstatus = "someday"\n');
    const draft = await benchDir("draft-bench");
    await writeRaw(draft, 'title = "Draft"\nruns = "two"\nstatus = "draft"\n');

    expect(await readBenchmarkManifest(bare)).toEqual({
      id: "bare-bench",
      title: "bare-bench",
      description: "Old",
      status: "published",
    });
    expect(await readBenchmarkManifest(odd)).toEqual({
      id: "odd-bench",
      title: "odd-bench",
      status: "published",
    });
    expect(await readBenchmarkManifest(draft)).toEqual({
      id: "draft-bench",
      title: "Draft",
      status: "draft",
    });
  });

  it("a key the manifest does not know is ignored, so a later release's manifest still reads", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(
      dir,
      'id = "report-writing-v1"\ntitle = "Report writing"\nlicense = "MIT"\n\n[origin]\nkind = "zip"\nmirror = "x"\n',
    );

    expect(await readBenchmarkManifest(dir)).toEqual({
      id: "report-writing-v1",
      title: "Report writing",
      status: "published",
      origin: { kind: "zip" },
    });
  });

  it("a directory with no manifest, or whose name is not an id, is not a Benchmark", async () => {
    const empty = await benchDir("half-deleted");
    await fs.writeFile(path.join(empty, "scoreboard.yaml"), "evaluations: []\n");
    const staging = await benchDir(".seeding");
    await writeRaw(staging, 'title = "Staged"\n');

    expect(await readBenchmarkManifest(empty)).toBeNull();
    expect(await readBenchmarkManifest(staging)).toBeNull();
  });

  it.each([
    ["another directory's id", 'id = "other-bench"\ntitle = "Copy"\n', "benchmark_id_mismatch"],
    ["an id outside the id characters", 'id = "../x"\n', "benchmark_manifest_invalid"],
    ["an id that is not text", "id = 7\n", "benchmark_manifest_invalid"],
    ["a version outside the supported formats", 'version = "1.0"\n', "benchmark_manifest_invalid"],
    ["a version that is not text", "version = 2026\n", "benchmark_manifest_invalid"],
    [
      "an author without a name",
      '[author]\nemail = "a@example.com"\n',
      "benchmark_manifest_invalid",
    ],
    ["an invalid update timestamp", 'last_update = "yesterday"\n', "benchmark_manifest_invalid"],
    [
      "a reference that is not an http(s) link",
      'references = ["javascript:alert(1)"]\n',
      "benchmark_manifest_invalid",
    ],
    ["an origin that is not a table", 'origin = "git"\n', "benchmark_manifest_invalid"],
    ["an origin kind nobody defined", '[origin]\nkind = "ftp"\n', "benchmark_manifest_invalid"],
    [
      "an origin without a kind",
      '[origin]\nurl = "https://x.test/"\n',
      "benchmark_manifest_invalid",
    ],
    [
      "an origin link that is not http(s)",
      '[origin]\nkind = "git"\nurl = "javascript:alert(1)"\n',
      "benchmark_manifest_invalid",
    ],
    [
      "an origin ref that is a branch, not a commit",
      '[origin]\nkind = "git"\nurl = "https://github.com/o/r/tree/main/x"\nref = "main"\n',
      "benchmark_manifest_invalid",
    ],
    ["an empty origin path", '[origin]\nkind = "git"\npath = ""\n', "benchmark_manifest_invalid"],
    ["text that is not TOML", "title = \n", "benchmark_manifest_invalid"],
  ])("a manifest with %s is refused", async (_case, toml, code) => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, toml);

    const error = await refusal(dir);

    expect(error).toBeInstanceOf(BenchmarkManifestError);
    expect((error as BenchmarkManifestError).code).toBe(code);
  });

  it("a refusal names what is wrong in one line, for the person who has to fix the file", async () => {
    const copied = await benchDir("copied-bench");
    await writeRaw(copied, 'id = "report-writing-v1"\n');
    const broken = await benchDir("broken-bench");
    await writeRaw(broken, 'title = "Broken"\nstatus = \n');

    const mismatch = (await refusal(copied)) as BenchmarkManifestError;
    const notToml = (await refusal(broken)) as BenchmarkManifestError;

    expect(mismatch.message).toContain("report-writing-v1");
    expect(mismatch.message).toContain("copied-bench");
    // Where the file breaks, never the parser's code frame.
    expect(notToml.message).toContain("line 2");
    expect(notToml.message).not.toContain("\n");
  });

  it("an origin's imported_at written as a TOML date-time reads as its ISO 8601 text", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, '[origin]\nkind = "zip"\nimported_at = 2026-10-09T08:00:00Z\n');

    expect((await readBenchmarkManifest(dir))?.origin).toEqual({
      kind: "zip",
      imported_at: "2026-10-09T08:00:00.000Z",
    });
  });

  it.each([
    ["a blank title", manifest({ title: "  " })],
    ["a title over 200 characters", manifest({ title: "t".repeat(201) })],
    ["a description over 2000 characters", manifest({ description: "d".repeat(2001) })],
    ["zero runs", manifest({ runs: 0 })],
    ["a fractional run count", manifest({ runs: 1.5 })],
    ["more than 1000 runs", manifest({ runs: 1001 })],
    ["a status nobody defined", manifest({ status: "someday" as BenchmarkManifest["status"] })],
    ["a version that is not a date version", manifest({ version: "v2" })],
    ["an origin ref that is not a commit", manifest({ origin: { kind: "git", ref: "main" } })],
    ["an id outside the id characters", manifest({ id: "../x" })],
  ])("a manifest with %s is never written", async (_case, refused) => {
    const dir = await benchDir("report-writing-v1");

    await expect(writeBenchmarkManifest(dir, refused)).rejects.toBeInstanceOf(
      BenchmarkManifestError,
    );
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("Benchmark versions", () => {
  const oct9 = new Date(2026, 9, 9, 12);

  it("a new Benchmark's first version is the day's .1", () => {
    expect(nextDateVersion(undefined, oct9)).toBe("2026.10.09.1");
  });

  it("another revision the same day takes the next number, and .10 follows .9", () => {
    expect(nextDateVersion("2026.10.09.1", oct9)).toBe("2026.10.09.2");
    expect(nextDateVersion("2026.10.09.9", oct9)).toBe("2026.10.09.10");
  });

  it("a revision on a later day starts again at .1", () => {
    expect(nextDateVersion("2026.10.08.7", oct9)).toBe("2026.10.09.1");
  });

  it("a version never goes backwards: one dated after today takes its next number", () => {
    expect(nextDateVersion("2026.10.11.2", oct9)).toBe("2026.10.11.3");
  });

  it("a previous version that does not parse counts for nothing: the day's .1", () => {
    expect(nextDateVersion("v2", oct9)).toBe("2026.10.09.1");
    expect(nextDateVersion("", oct9)).toBe("2026.10.09.1");
  });

  it("versions order by date, then by number numerically; what is not a version sorts first", () => {
    expect(compareDateVersions("2026.08.29.1", "2026.08.29.1")).toBe(0);
    expect(compareDateVersions("2026.08.29.2", "2026.08.29.10")).toBeLessThan(0);
    expect(compareDateVersions("2026.09.01.1", "2026.08.29.9")).toBeGreaterThan(0);
    expect(compareDateVersions("", "2026.08.29.1")).toBeLessThan(0);
    expect(compareDateVersions("7", "2026.08.29.1")).toBeLessThan(0);
    expect(compareDateVersions("", "")).toBe(0);
  });

  it("the legacy spelling is the same version, and the next revision continues it", () => {
    expect(compareDateVersions("2026-08-29.1", "2026.08.29.1")).toBe(0);
    expect(compareDateVersions("2026.09.10.1", "2026-09-09.9")).toBeGreaterThan(0);
    expect(compareDateVersions("2026-09-09.9", "2026.09.09.10")).toBeLessThan(0);
    expect(nextDateVersion("2026-10-09.3", oct9)).toBe("2026.10.09.4");
  });
});
