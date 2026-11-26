/**
 * The Example and built-in Benchmarks, written into the data folder the first time the workbench
 * loads (PRFC-0036, "Data": seeded once, never again).
 *
 * The workbench folder carries them under `seeds/<id>/` (scripts/build-seeds.mjs). On a load that
 * finds no `.seeded` marker in the data folder, every folder of `seeds/` is copied in: staged under
 * `.seeding/` and renamed into place (place.ts), so a Benchmark lands whole or not at all; an id
 * the data folder already holds is left alone, and a link or anything else that is not a plain
 * file or folder is not copied. Once all of them are in, `.seeded` is written, and from then on
 * nothing is ever seeded again: a Benchmark someone deleted stays deleted, and a later version's new
 * seeds reach only an installation that has not loaded yet. The marker travels with the
 * workbench's data in an Agent export, and an upgrade's migration writes one beside the Benchmarks
 * it moves in.
 *
 * A seed that cannot be copied leaves the marker unwritten, so the next load tries again (the ids
 * already in place are left alone then); the load itself never fails over it.
 */
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isValidId } from "./format/ids.js";
import { placeBenchmark } from "./place.js";

/** The marker a seeded data folder carries. */
export const SEEDED_MARKER = ".seeded";

/** Whether anything is at `p`; a link counts, wherever it points. */
async function occupied(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Copies the tree at `from` into `to` (made empty by the caller): folders and plain files only. */
async function copyTree(from: string, to: string): Promise<void> {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(target);
      await copyTree(source, target);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    }
  }
}

/** What a seeding did: the ids it placed and the ones the data folder already held. */
export interface SeedResult {
  /** False when the marker was already there and nothing was looked at. */
  ran: boolean;
  placed: string[];
  kept: string[];
}

/**
 * Seeds `dataDir` from `seedsDir` unless it carries the marker (see the module doc). Throws when a
 * seed could not be copied, after copying the rest; the marker is then not written.
 */
export async function seedOnce(
  dataDir: string,
  seedsDir: string,
  now = new Date(),
): Promise<SeedResult> {
  const marker = path.join(dataDir, SEEDED_MARKER);
  if (await occupied(marker)) return { ran: false, placed: [], kept: [] };
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  let seeds: string[] = [];
  try {
    const entries = await fs.readdir(seedsDir, { withFileTypes: true });
    seeds = entries
      .filter((entry) => entry.isDirectory() && isValidId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    // A workbench folder without seeds has nothing to seed; anything else is a failure.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const placed: string[] = [];
  const kept: string[] = [];
  const failures: string[] = [];
  for (const id of seeds) {
    if (await occupied(path.join(dataDir, id))) {
      kept.push(id);
      continue;
    }
    try {
      await placeBenchmark(dataDir, id, (stage) => copyTree(path.join(seedsDir, id), stage));
      placed.push(id);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Another writer placed the id first: it is held, which is all a seed asks.
      if (code === "EEXIST") kept.push(id);
      else failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Could not seed ${failures.length} Benchmark(s): ${failures.join("; ")}`);
  }
  await fs
    .writeFile(
      marker,
      `${JSON.stringify({ seededAt: now.toISOString(), placed, kept }, null, 1)}\n`,
      { flag: "wx" },
    )
    .catch((error: NodeJS.ErrnoException) => {
      // Another load wrote it first: the folder is seeded either way.
      if (error.code !== "EEXIST") throw error;
    });
  return { ran: true, placed, kept };
}
