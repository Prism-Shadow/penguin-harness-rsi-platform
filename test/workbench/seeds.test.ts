/**
 * The Benchmarks the workbench seeds its data folder with on its first load
 * (workbenches/benchmark/lib/seeds.ts, through the handler's load).
 *
 * Given a seeds folder of two Benchmarks and the catalog file beside them, and a fresh data
 * folder:
 * - When the workbench first loads, every seed folder is copied in byte for byte and the data
 *   folder is marked seeded; the catalog file stays behind, a link inside a seed is not copied,
 *   and an id the data folder already holds is left as it is.
 * - When the workbench loads again after the marker, nothing is seeded again: a seed someone
 *   deleted stays deleted, and a seed new since then does not arrive.
 * - When a seed cannot be copied, the load still answers with the seeds that landed, says so in
 *   the host's log and writes no marker; the next load copies it and leaves the others alone.
 * - When requests arrive before the seeding has finished, they are answered after it, with the
 *   seeds in place.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BenchmarksResponse } from "../../workbenches/benchmark/lib/api.js";
import { createWorkbench } from "../../workbenches/benchmark/lib/workbench.js";
import { entriesOf, exists, write } from "../helpers/files.js";
import {
  agentFolders,
  canCreateSymlink,
  fakeHost,
  requestOf,
  statusOf,
  tempRoot,
  type FakeHost,
} from "../helpers/workbench.js";

const itWithSymlinks = it.skipIf(!(await canCreateSymlink()));

/** Whether a folder's mode can keep this process from reading it (not as root, not on Windows). */
async function canDenyReads(): Promise<boolean> {
  const dir = await tempRoot("rsi-deny-probe-");
  const locked = path.join(dir, "locked");
  try {
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o000);
    try {
      await fs.readdir(locked);
      return false;
    } catch {
      return true;
    }
  } finally {
    await fs.chmod(locked, 0o700).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
}
const itWithDeniedReads = it.skipIf(!(await canDenyReads()));

/** A seed as build-seeds writes one: its manifest, an empty scoreboard and one case. */
async function writeSeed(seedsDir: string, id: string, title = `Seed ${id}`): Promise<void> {
  const dir = path.join(seedsDir, id);
  await write(
    dir,
    "benchmark_config.toml",
    stringifyToml({ id, title, status: "published", runs: 1, origin: { kind: "builtin" } }),
  );
  await write(dir, "scoreboard.yaml", "evaluations: []\n");
  await write(dir, "CASE-001-a/statement/README.md", `# The case of ${id}\n`);
  await write(dir, "CASE-001-a/rubric/README.md", "- 100 pts\n");
}

/** Every file under `dir`, "/"-separated, with its text. */
async function filesOf(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, abs).split(path.sep).join("/")] = await fs.readFile(abs, "utf8");
  }
  return out;
}

describe("seeding the data folder", () => {
  let root: string;
  let seedsDir: string;
  let dataDir: string;
  let host: FakeHost;

  beforeEach(async () => {
    root = await tempRoot("rsi-seeds-");
    seedsDir = path.join(root, "seeds");
    await writeSeed(seedsDir, "seed-a");
    await writeSeed(seedsDir, "seed-b");
    // build-seeds writes the catalog beside the seed folders.
    await write(seedsDir, "catalog.json", '[{ "id": "seed-a" }, { "id": "seed-b" }]\n');
    host = await fakeHost(root);
    dataDir = agentFolders(root).dataDir;
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** A load of the workbench over `host`, as the host loads it after a start or a reload. */
  const load = () => createWorkbench(host, { seedsDir });
  const listed = async (main = load()) =>
    ((await main.handle(requestOf("GET", "/benchmarks"))).body as BenchmarksResponse).benchmarks;

  it("copies every seed folder in on the first load, byte for byte, marks the folder seeded and leaves the catalog behind", async () => {
    const benchmarks = await listed();

    expect(benchmarks.map((b) => [b.id, b.title, b.caseCount])).toEqual([
      ["seed-a", "Seed seed-a", 1],
      ["seed-b", "Seed seed-b", 1],
    ]);
    for (const id of ["seed-a", "seed-b"]) {
      expect(await filesOf(path.join(dataDir, id)), id).toEqual(
        await filesOf(path.join(seedsDir, id)),
      );
    }
    expect(await entriesOf(dataDir)).toEqual([".seeded", "seed-a", "seed-b"]);
  });

  it("leaves an id the data folder already holds as it is", async () => {
    await write(
      path.join(dataDir, "seed-a"),
      "benchmark_config.toml",
      stringifyToml({ id: "seed-a", title: "Mine", status: "published" }),
    );

    const benchmarks = await listed();

    expect(benchmarks.map((b) => [b.id, b.title])).toEqual([
      ["seed-a", "Mine"],
      ["seed-b", "Seed seed-b"],
    ]);
    expect(await exists(path.join(dataDir, "seed-a", "CASE-001-a"))).toBe(false);
  });

  itWithSymlinks("does not copy a link inside a seed", async () => {
    const secret = path.join(root, "secret.md");
    await fs.writeFile(secret, "not a seed's\n");
    await fs.symlink(secret, path.join(seedsDir, "seed-a", "CASE-001-a", "statement", "link.md"));

    await listed();

    const statement = path.join(dataDir, "seed-a", "CASE-001-a", "statement");
    expect(await entriesOf(statement)).toEqual(["README.md"]);
  });

  it("seeds nothing again once the folder is marked: a deleted seed stays deleted, a new one does not arrive", async () => {
    const first = load();
    expect((await listed(first)).map((b) => b.id)).toEqual(["seed-a", "seed-b"]);
    expect(statusOf(await first.handle(requestOf("DELETE", "/benchmarks/seed-a")))).toBe(204);
    await writeSeed(seedsDir, "seed-c");

    const benchmarks = await listed(load());

    expect(benchmarks.map((b) => b.id)).toEqual(["seed-b"]);
  });

  itWithDeniedReads(
    "a seed that cannot be copied is logged and leaves the folder unmarked, and the next load copies it alone",
    async () => {
      const locked = path.join(seedsDir, "seed-b", "CASE-001-a");
      await fs.chmod(locked, 0o000);
      const benchmarks = await listed().finally(() => fs.chmod(locked, 0o755));

      expect(benchmarks.map((b) => b.id)).toEqual(["seed-a"]);
      expect(host.lines.some((line) => line.includes("seed-b"))).toBe(true);
      // Neither the marker nor a half-copied seed.
      expect(await entriesOf(dataDir)).toEqual(["seed-a"]);

      // Someone has worked on the seed that landed since.
      await write(path.join(dataDir, "seed-a"), "CASE-001-a/statement/notes.md", "mine\n");
      const again = await listed();

      expect(again.map((b) => b.id)).toEqual(["seed-a", "seed-b"]);
      expect(await filesOf(path.join(dataDir, "seed-b"))).toEqual(
        await filesOf(path.join(seedsDir, "seed-b")),
      );
      expect(
        await exists(path.join(dataDir, "seed-a", "CASE-001-a", "statement", "notes.md")),
      ).toBe(true);
      expect(await entriesOf(dataDir)).toEqual([".seeded", "seed-a", "seed-b"]);
    },
  );

  it("answers requests sent before the seeding finished once it has, with the seeds in place", async () => {
    const main = load();

    const answers = await Promise.all([
      main.handle(requestOf("GET", "/benchmarks")),
      main.handle(requestOf("GET", "/benchmarks/seed-b/cases")),
    ]);

    expect((answers[0].body as BenchmarksResponse).benchmarks.map((b) => b.id)).toEqual([
      "seed-a",
      "seed-b",
    ]);
    expect(answers[1].body).toEqual({ cases: [{ id: "CASE-001-a", title: "The case of seed-b" }] });
  });
});
