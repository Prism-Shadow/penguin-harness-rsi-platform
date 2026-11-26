/**
 * The handler's routes, below the workbench's API mount
 * (`/api/projects/:projectId/agents/:agentId/workbenches/benchmark/api/`). The host has checked
 * that the request comes from a member of the Project before it gets here; every member may do
 * everything below (PRFC-0036: no owner rule any more).
 *
 *   GET    /benchmarks                                  the Benchmarks (`?local=1`, what a page
 *                                                       asked a machine's server module, is the
 *                                                       same answer)
 *   POST   /benchmarks                                  create one by hand
 *   DELETE /benchmarks/:benchmarkId                     remove one whole
 *   POST   /benchmarks/archive                          import a package: JSON `{ dataBase64,
 *                                                       overwrite?, origin? }`, or the zip itself
 *                                                       as the body (`?overwrite=1`)
 *   GET    /benchmarks/:benchmarkId/archive             export the package
 *   GET    /benchmarks/:benchmarkId/cases[?page=]       its cases, five a page when paged
 *   GET    /benchmarks/:benchmarkId/cases/:caseId/files[/content]          a case's statement
 *   GET    /benchmarks/:benchmarkId/cases/:caseId/rubric/files[/content]   a case's rubric
 *   GET    /prompt?kind=…  (or POST /prompt, the same fields as JSON)       what Start sends
 *   POST   /tasks                                       record a task the page started
 *   GET    /tasks[?benchmarkId=]                        the tasks recorded, newest first
 *
 * Requests, answers and error codes are those of the data routes they replace
 * (`/api/projects/:projectId/benchmarks…`); a refusal answers `{ error: { code, message,
 * details? } }`.
 */
import type { WorkbenchRequest, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";
import type {
  BenchmarkArchiveGitOrigin,
  BenchmarkArchiveImportResponse,
  BenchmarkCreateResponse,
  CaseMaterial,
  PromptResponse,
  TaskRecordResponse,
  TasksResponse,
} from "./api.js";
import { benchmarkTooLarge } from "./archive.js";
import { badRequest, errorResponse, notFound } from "./errors.js";
import { isValidId } from "./format/ids.js";
import { benchmarkOf, parsePromptRequest, promptQueryBody, specOf } from "./prompt-request.js";
import { benchmarkFolder, buildRequest } from "./prompts.js";
import type { BenchmarkCaseInput, BenchmarkStore } from "./store.js";
import { parseTaskRecord, type TaskLog } from "./task-log.js";
import {
  isHttpUrl,
  objectBody,
  optionalInteger,
  optionalString,
  requireString,
  requireText,
  requireValidId,
} from "./validate.js";
import { MAX_ARCHIVE_BYTES } from "./zip-guards.js";

export interface RouteDeps {
  store: BenchmarkStore;
  tasks: TaskLog;
  /** The workbench's data folder (absolute), which the prompts name the Benchmarks under. */
  dataDir: string;
  log: (line: string) => void;
}

const TEXT_PREVIEW_BYTES = 256 * 1024;

/** Case directories carry the `CASE-` prefix the reader lists by; the rest is the id alphabet. */
const CASE_ID_PATTERN = /^CASE-[A-Za-z0-9_-]+$/;
const MAX_CASES = 100;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
/** Statement and rubric bodies: generous, but a hand-written case is a page, not a corpus. */
const MAX_BODY = 100_000;
/**
 * Runs per case. Every run is one evaluation of the Test Agent, so the count multiplies the cost
 * of each optimization round; a stored value has to stay within it to remain usable.
 */
const MAX_RUNS = 1000;

/** The longest `dataBase64` a zip within the 14MB cap encodes to, refused before it is decoded. */
const MAX_ARCHIVE_BASE64 = Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4;

/** The only `ref` a git origin records: a commit, since a branch or a tag can move. */
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * An import request's `origin`: absent, or the repository folder the package was fetched from —
 * an http(s) link, the 40-character commit it resolved to and the folder inside the repository.
 * The handler never fetches them: they go into the copy's manifest.
 */
function optionalGitOrigin(body: Record<string, unknown>): BenchmarkArchiveGitOrigin | undefined {
  const raw = body.origin;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("origin must be an object.");
  const origin = raw as Record<string, unknown>;
  if (origin.kind !== "git") throw badRequest('origin.kind must be "git".');
  const url = requireString(origin, "url", { minLen: 1, maxLen: 2048, label: "origin.url" });
  if (!isHttpUrl(url)) throw badRequest("origin.url must be an http(s) link.");
  const ref = requireString(origin, "ref", { label: "origin.ref" });
  if (!COMMIT.test(ref)) throw badRequest("origin.ref must be a 40-character commit id.");
  const folder = requireString(origin, "path", { minLen: 1, maxLen: 1024, label: "origin.path" });
  return { kind: "git", url, ref, path: folder };
}

/** The `cases` of a create request: non-empty, capped, unique `CASE-…` ids, every text present. */
function requireCases(body: Record<string, unknown>): BenchmarkCaseInput[] {
  const raw = body.cases;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("cases must be a non-empty array.");
  if (raw.length > MAX_CASES) throw badRequest(`cases must hold at most ${MAX_CASES} entries.`);
  const seen = new Set<string>();
  return raw.map((item: unknown, i: number) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`cases[${i}] must be an object.`);
    }
    const c = item as Record<string, unknown>;
    const id = requireString(c, "id", { maxLen: 100, label: `cases[${i}].id` });
    if (!CASE_ID_PATTERN.test(id)) {
      throw badRequest(
        `cases[${i}].id must start with "CASE-" and use only letters, digits, "_" and "-".`,
      );
    }
    if (seen.has(id)) throw badRequest(`cases[${i}].id is a duplicate: ${id}`);
    seen.add(id);
    return {
      id,
      title: requireText(c, "title", MAX_TITLE, `cases[${i}].title`),
      statement: requireText(c, "statement", MAX_BODY, `cases[${i}].statement`),
      rubric: requireText(c, "rubric", MAX_BODY, `cases[${i}].rubric`),
    };
  });
}

/** A JSON body as an object, or the 400 the data routes answered for one that is not. */
function jsonBody(req: WorkbenchRequest): Record<string, unknown> {
  if (req.body === null && req.bytes !== undefined) {
    throw badRequest("Request body must be valid JSON.");
  }
  return objectBody(req.body);
}

/** A download or an inline view of bytes, hardened as the host hardens its file routes. */
function fileResponse(
  data: Uint8Array,
  headers: Record<string, string>,
  fileName: string,
  disposition: "attachment" | "inline",
): WorkbenchResponse {
  return {
    status: 200,
    headers: {
      ...headers,
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "x-content-type-options": "nosniff",
    },
    bytes: data,
  };
}

/** The routes over `deps`: one function from a request to its answer, which never throws. */
export function benchmarkRoutes(
  deps: RouteDeps,
): (req: WorkbenchRequest) => Promise<WorkbenchResponse> {
  const { store, tasks } = deps;

  const createBenchmark = async (req: WorkbenchRequest): Promise<WorkbenchResponse> => {
    const body = jsonBody(req);
    const id = requireString(body, "id", { minLen: 1, maxLen: 100 });
    if (!isValidId(id)) throw badRequest('id may only contain letters, digits, "_" and "-".');
    const title = requireText(body, "title", MAX_TITLE, "title");
    const description = optionalString(body, "description", { maxLen: MAX_DESCRIPTION });
    const runs = optionalInteger(body, "runs", 1, MAX_RUNS) ?? 1;
    const cases = requireCases(body);
    const benchmark = await store.create({
      id,
      title,
      ...(description !== undefined ? { description } : {}),
      runs,
      cases,
    });
    return { status: 201, body: { benchmark } satisfies BenchmarkCreateResponse };
  };

  // Import a package from a zip. With `overwrite` it replaces a Benchmark of the same id whole,
  // evaluation records included — the page says so before it sends one.
  const importArchive = async (req: WorkbenchRequest): Promise<WorkbenchResponse> => {
    let archive: Uint8Array;
    let overwrite: boolean;
    let origin: BenchmarkArchiveGitOrigin | undefined;
    if (req.body === null && req.bytes !== undefined) {
      archive = req.bytes;
      overwrite = req.query.overwrite === "1";
    } else {
      const body = objectBody(req.body);
      const dataBase64 = requireString(body, "dataBase64");
      // The same 413 the decoded size would get, answered before a byte is decoded.
      if (dataBase64.length > MAX_ARCHIVE_BASE64) {
        throw benchmarkTooLarge("The zip archive exceeds the 14MB limit.");
      }
      archive = new Uint8Array(Buffer.from(dataBase64, "base64"));
      overwrite = body.overwrite === true;
      origin = optionalGitOrigin(body);
    }
    const benchmark = await store.importArchive(archive, {
      overwrite,
      ...(origin !== undefined ? { origin } : {}),
    });
    return { status: 201, body: { benchmark } satisfies BenchmarkArchiveImportResponse };
  };

  // Export a published Benchmark's package: a binary attachment the import takes back unchanged.
  const exportArchive = async (benchmarkId: string): Promise<WorkbenchResponse> => {
    const { fileName, data } = await store.exportArchive(benchmarkId);
    // An id and a date version: the encoded name is the name itself.
    return fileResponse(data, { "content-type": "application/zip" }, fileName, "attachment");
  };

  const listCases = async (req: WorkbenchRequest, benchmarkId: string) => {
    const raw = req.query.page;
    const page = raw === undefined ? undefined : Number(raw);
    if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) {
      throw badRequest("page must be a positive integer.");
    }
    return { body: await store.listCases(benchmarkId, page) };
  };

  const caseFiles = async (
    req: WorkbenchRequest,
    benchmarkId: string,
    caseId: string,
    material: CaseMaterial,
  ): Promise<WorkbenchResponse> => ({
    body: await store.listCaseFiles(benchmarkId, caseId, req.query.path ?? "", material),
  });

  const caseFileContent = async (
    req: WorkbenchRequest,
    benchmarkId: string,
    caseId: string,
    material: CaseMaterial,
  ): Promise<WorkbenchResponse> => {
    const download = req.query.download === "1";
    const boundedPreview = !download && req.query.preview === "1";
    const { data, fileName, contentType, scriptable, truncated } = await store.readCaseFile(
      benchmarkId,
      caseId,
      req.query.path ?? "",
      material,
      boundedPreview ? { maxBytes: TEXT_PREVIEW_BYTES } : undefined,
    );
    // Case material is browsed the way a Workspace is, and gets the same inline hardening: HTML
    // is shown as text, an SVG keeps its type for an <img> but is inert when opened directly.
    const inertSvg = !download && scriptable === "svg";
    return fileResponse(
      data,
      {
        "content-type":
          !download && scriptable === "html" ? "text/plain; charset=utf-8" : contentType,
        ...(inertSvg ? { "content-security-policy": "sandbox" } : {}),
        ...(truncated ? { "x-content-truncated": "1" } : {}),
      },
      fileName,
      download ? "attachment" : "inline",
    );
  };

  const prompt = async (raw: Record<string, unknown>): Promise<WorkbenchResponse> => {
    const request = parsePromptRequest(raw);
    const benchmarkId = benchmarkOf(request);
    let benchmarkDir: string | undefined;
    let benchmarkRuns = 1;
    if (benchmarkId !== undefined) {
      const held = await store.get(benchmarkId);
      benchmarkDir = benchmarkFolder(deps.dataDir, benchmarkId, held !== null);
      benchmarkRuns = held?.runs ?? 1;
    }
    const built = buildRequest(
      specOf(request, benchmarkDir, benchmarkRuns),
      request.language,
      deps.dataDir,
    );
    return {
      body: {
        prompt: built.prompt,
        skills: built.skills,
        required: built.required,
      } satisfies PromptResponse,
    };
  };

  const recordTask = async (req: WorkbenchRequest): Promise<WorkbenchResponse> => {
    const task = await tasks.append(parseTaskRecord(jsonBody(req)));
    return { status: 201, body: { task } satisfies TaskRecordResponse };
  };

  const listTasks = (req: WorkbenchRequest): WorkbenchResponse => {
    const benchmarkId = req.query.benchmarkId;
    if (benchmarkId !== undefined && !isValidId(benchmarkId)) {
      throw badRequest('benchmarkId may only contain letters, digits, "_" and "-".');
    }
    return { body: { tasks: tasks.list(benchmarkId) } satisfies TasksResponse };
  };

  const route = async (req: WorkbenchRequest): Promise<WorkbenchResponse> => {
    const segments = req.path.split("/").filter((segment) => segment !== "");
    const method = req.method.toUpperCase();
    const [head, id, sub, caseId, ...rest] = segments;
    if (head === "prompt" && segments.length === 1) {
      if (method === "GET") return prompt(promptQueryBody(req.query));
      if (method === "POST") return prompt(jsonBody(req));
    }
    if (head === "tasks" && segments.length === 1) {
      if (method === "GET") return listTasks(req);
      if (method === "POST") return recordTask(req);
    }
    if (head === "benchmarks") {
      if (id === undefined) {
        if (method === "GET") return { body: await store.list() };
        if (method === "POST") return createBenchmark(req);
      } else if (id === "archive" && sub === undefined && method === "POST") {
        return importArchive(req);
      } else if (sub === undefined) {
        if (method === "DELETE") {
          await store.remove(requireValidId(id));
          return { status: 204 };
        }
      } else if (method === "GET") {
        const benchmarkId = requireValidId(id);
        if (sub === "archive" && caseId === undefined) return exportArchive(benchmarkId);
        if (sub === "cases" && caseId === undefined) return listCases(req, benchmarkId);
        if (sub === "cases" && caseId !== undefined) {
          const caseDir = requireValidId(caseId);
          const material: CaseMaterial = rest[0] === "rubric" ? "rubric" : "statement";
          const tail = material === "rubric" ? rest.slice(1) : rest;
          if (tail.length === 1 && tail[0] === "files") {
            return caseFiles(req, benchmarkId, caseDir, material);
          }
          if (tail.length === 2 && tail[0] === "files" && tail[1] === "content") {
            return caseFileContent(req, benchmarkId, caseDir, material);
          }
        }
      }
    }
    throw notFound("Resource does not exist or you do not have access.");
  };

  return async (req) => {
    try {
      return await route(req);
    } catch (error) {
      return errorResponse(error, deps.log);
    }
  };
}
