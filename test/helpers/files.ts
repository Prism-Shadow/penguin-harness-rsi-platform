/**
 * Small file fixtures the Benchmark suites share: writing a file at a "/"-separated path under a
 * folder, asking whether anything is at a path, and listing a folder that may not exist yet.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Writes `data` at `rel` ("/"-separated) under `dir`, creating the folders on the way. */
export async function write(dir: string, rel: string, data: string | Uint8Array): Promise<void> {
  const file = path.join(dir, ...rel.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

/** Whether anything is at `p`; a symlink counts, wherever it points. */
export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** The names in `dir`, sorted; none when the folder is not there (yet). */
export async function entriesOf(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
