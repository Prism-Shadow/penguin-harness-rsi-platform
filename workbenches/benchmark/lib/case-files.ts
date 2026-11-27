/**
 * A case's files, listed and read for the page's file browser: one directory's entries, and one
 * file's bytes in full or its beginning. The rules are the host's Workspace browser's, which the
 * Evaluation Center used and a workbench cannot reach: a relative path, once resolved, stays
 * inside the folder — checked lexically and again on the canonical path, so neither `..` nor a
 * symlink leads out — and IO happens on the canonical path, which has no link left in it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { CaseFilesResponse, CaseFileEntry } from "./api.js";
import { WorkbenchError, badRequest } from "./errors.js";

/** Per-file read cap: a preview or a download reads the whole file into memory. */
const MAX_READ_BYTES = 50 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

/** One file read for a response. */
export interface CaseFileContent {
  data: Uint8Array;
  fileName: string;
  contentType: string;
  /** A document a browser would run scripts in when shown inline. */
  scriptable: "html" | "svg" | false;
  /** A bounded preview that returned only the beginning of the file. */
  truncated?: boolean;
}

const missing = (what: string) =>
  new WorkbenchError(404, "path_not_found", `${what} does not exist.`);

/** Whether `target` is `base` or inside it, by whole path segments. */
function isInside(target: string, base: string): boolean {
  const rel = path.relative(base, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** The canonical path of `rel` under `root`, once it is checked to stay there. */
async function resolveRead(root: string, rel: string): Promise<string> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(path.resolve(root));
  } catch {
    throw missing("Directory");
  }
  if (rel.includes("\0")) throw badRequest("path is invalid.");
  const target = path.resolve(root, rel === "" ? "." : rel);
  if (!isInside(target, path.resolve(root))) throw badRequest("path must be inside the case.");
  let canonical: string;
  try {
    canonical = await fs.realpath(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw missing("File");
    throw err;
  }
  if (!isInside(canonical, realRoot)) throw badRequest("path must be inside the case.");
  return canonical;
}

/** The entries of the directory `rel` under `root`: directories first, then by name. */
export async function listFolder(root: string, rel: string): Promise<CaseFilesResponse> {
  const dir = await resolveRead(root, rel);
  const realRoot = await fs.realpath(path.resolve(root));
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw missing("Directory");
    if (code === "ENOTDIR") throw badRequest("path is not a directory.");
    throw err;
  }
  const listed = await Promise.all(
    dirents.map(async (d): Promise<CaseFileEntry | null> => {
      try {
        const canonical = await fs.realpath(path.join(dir, d.name));
        if (!isInside(canonical, realRoot)) return null;
        const stat = await fs.stat(canonical);
        return {
          name: d.name,
          kind: stat.isDirectory() ? "dir" : "file",
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    }),
  );
  const entries = listed.filter((entry): entry is CaseFileEntry => entry !== null);
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
  return { path: rel, entries };
}

/** The file `rel` under `root`: whole, or its first `maxBytes` (then `truncated`). */
export async function readFolderFile(
  root: string,
  rel: string,
  options?: { maxBytes?: number },
): Promise<CaseFileContent> {
  const file = await resolveRead(root, rel);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    throw missing("File");
  }
  if (stat.isDirectory()) throw badRequest("path is a directory.");
  const maxBytes = options?.maxBytes;
  if (maxBytes === undefined && stat.size > MAX_READ_BYTES) {
    throw new WorkbenchError(413, "file_too_large", "File exceeds the 50MB read limit.");
  }
  let data: Uint8Array;
  let truncated = false;
  if (maxBytes !== undefined && stat.size > maxBytes) {
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      data = buffer.subarray(0, bytesRead);
      truncated = true;
    } finally {
      await handle.close();
    }
  } else {
    data = await fs.readFile(file);
  }
  const ext = path.extname(file).toLowerCase();
  return {
    data,
    fileName: path.basename(file),
    contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    scriptable: ext === ".html" || ext === ".htm" ? "html" : ext === ".svg" ? "svg" : false,
    ...(truncated ? { truncated: true } : {}),
  };
}
