/**
 * The page's files: `GET /api/rsi-workbench/ui/<path>` answers a file of the package's built `ui/`
 * folder (the iframe app) and nothing else — a path with an empty, `.` or `..` segment, a
 * backslash, or one reached through any link (out of the folder or inside it), is a 404. The
 * harness's contained static-file rule (`containedFile` / `uiFileResponse`), kept here until the
 * server face offers it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import type { RouteEnv } from "./routes.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** A relative path of plain segments: no leading slash, no backslash, no empty, `.` or `..` segment. */
export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * The file `rel` names under `dir`, or null: a safe relative path to a regular file reached
 * through no link — resolved, it is exactly `rel` under the resolved `dir`, so neither a link out
 * of the folder nor one inside it hands out a file. `dir` itself may lie below a link (a package
 * in a linked prefix).
 */
export async function containedFile(dir: string, rel: string): Promise<string | null> {
  if (!isSafeRelPath(rel)) return null;
  try {
    const root = await fs.realpath(dir);
    const file = await fs.realpath(path.join(dir, rel));
    if (file !== path.join(root, rel)) return null;
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function fileResponse(c: Context<RouteEnv>, file: string): Promise<Response> {
  const body = await fs.readFile(file);
  return c.body(new Uint8Array(body), 200, {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    // Revalidated on every load, so a new build of the package is what the next frame shows.
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
}

/** The routes under `/api/rsi-workbench/ui`, serving `uiDir`. */
export function uiRoutes(uiDir: string): Hono<RouteEnv> {
  const app = new Hono<RouteEnv>();
  const serve = async (c: Context<RouteEnv>, rel: string) => {
    const file = await containedFile(uiDir, rel);
    if (file === null) {
      return c.json({ error: { code: "not_found", message: "No such file." } }, 404);
    }
    return fileResponse(c, file);
  };
  app.get("/", (c) => serve(c, "index.html"));
  app.get("/:rel{.+}", (c) => serve(c, c.req.param("rel")));
  return app;
}
