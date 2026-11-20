/**
 * Writes a file in one step: to a temporary file beside it, then a rename over it, so a reader sees
 * the old bytes or the new ones and a crash part-way leaves no half-written manifest. The rename
 * replaces a symlink standing at the target rather than writing through it: a Benchmark's folder
 * is Agent-writable, and a link planted there must not carry a write outside it.
 */
import path from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";

export async function atomicWriteFile(target: string, content: string | Uint8Array): Promise<void> {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, {
      ...(typeof content === "string" ? { encoding: "utf8" as const } : {}),
      flush: true,
    });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
