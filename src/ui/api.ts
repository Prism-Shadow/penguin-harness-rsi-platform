/**
 * The page's requests: plain same-origin `fetch` with the viewer's login cookie, to this plugin's
 * routes and the few host routes the page needs. The frame is served from the same origin as the
 * Web App, so the cookie and the host's same-origin write check both apply as they do there.
 *
 * Errors arrive in the host's shape, `{ error: { code, message, details? } }`, and are thrown as
 * `ApiError` with the status, the code and the details; a request that never reached the server is
 * `network_error`.
 *
 * An admin's lists are asked of this server and of each machine apart (`?machine=<id>`, which this
 * plugin's route reads through the host's machine client), so the page shows each answer as it
 * lands. A case's files and a package of a copy only another machine holds are read through the
 * host's machine proxy: the same `/api/...` path under `/server/<machineId>` (`apiUrl`).
 */
import type {
  ApprovalMode,
  BenchmarkArchiveImportRequest,
  BenchmarkArchiveImportResponse,
  BenchmarkCasesResponse,
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseFilesResponse,
  CaseMaterial,
  TaskPreviewResponse,
  TaskStartResponse,
  TasksResponse,
  WorkbenchContext,
  WorkbenchTaskRequest,
} from "../api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An API path re-rooted onto `machineId` through the host's machine proxy; as-is for this server. */
export function apiUrl(path: string, machineId: string | null = null): string {
  if (machineId === null || !path.startsWith("/api")) return path;
  return `/server/${encodeURIComponent(machineId)}${path}`;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", "");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!response.ok) {
    const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : `http_${response.status}`,
      typeof error.message === "string" ? error.message : "",
      isRecord(error.details) ? error.details : undefined,
    );
  }
  if (parsed === undefined && text !== "") {
    throw new ApiError(response.status, "bad_response", "");
  }
  return parsed as T;
}

/** What `POST …/suggest-id` answers. */
export interface SuggestIdResponse {
  id: string;
  source: "model" | "fallback" | "placeholder";
  reason?: string;
}

/** The viewer's display preferences, as far as this page reads them. */
export interface PrefsResponse {
  prefs?: { currency?: string | null };
}

const enc = encodeURIComponent;

/** The requests about one Project. */
export function projectApi(projectId: string) {
  const project = `/api/projects/${enc(projectId)}`;
  const benchmarks = `${project}/benchmarks`;
  const one = (benchmarkId: string) => `${benchmarks}/${enc(benchmarkId)}`;
  const caseFiles = (benchmarkId: string, caseId: string, material: CaseMaterial) =>
    `${one(benchmarkId)}/cases/${enc(caseId)}${material === "rubric" ? "/rubric" : ""}/files`;
  /** `path`, asking `machineId`'s copy instead of this server's (null). */
  const of = (path: string, machineId: string | null) =>
    machineId === null ? path : `${path}?machine=${enc(machineId)}`;
  const caseList = (id: string, machineId: string | null, query: URLSearchParams) => {
    if (machineId !== null) query.set("machine", machineId);
    return `${one(id)}/cases${query.size ? `?${query}` : ""}`;
  };
  return {
    /** This server's Benchmarks (null), or one machine's. */
    listBenchmarks: (machineId: string | null = null) =>
      call<BenchmarksResponse>("GET", of(benchmarks, machineId)),
    context: () => call<WorkbenchContext>("GET", `${benchmarks}/context`),
    createBenchmark: (body: BenchmarkCreateRequest) =>
      call<BenchmarkCreateResponse>("POST", benchmarks, body),
    deleteBenchmark: (benchmarkId: string) => call<void>("DELETE", one(benchmarkId)),
    importArchive: (body: BenchmarkArchiveImportRequest) =>
      call<BenchmarkArchiveImportResponse>("POST", `${benchmarks}/archive`, body),
    /** The package download, from the server holding the copy (null: this server). */
    archiveUrl: (benchmarkId: string, machineId: string | null) =>
      apiUrl(`${one(benchmarkId)}/archive`, machineId),
    /** A Benchmark's cases in this server's copy (null), or in one machine's. */
    cases: (
      benchmarkId: string,
      machineId: string | null = null,
      selection?: number | readonly string[],
    ) => {
      const query = new URLSearchParams();
      if (typeof selection === "number") query.set("page", String(selection));
      else for (const id of selection ?? []) query.append("id", id);
      return call<BenchmarkCasesResponse>("GET", caseList(benchmarkId, machineId, query));
    },
    caseIds: (benchmarkId: string, machineId: string | null) =>
      call<{ ids: string[] }>(
        "GET",
        caseList(benchmarkId, machineId, new URLSearchParams({ index: "1" })),
      ),
    caseFiles: (
      benchmarkId: string,
      caseId: string,
      material: CaseMaterial,
      path: string,
      machineId: string | null,
    ) =>
      call<CaseFilesResponse>(
        "GET",
        `${apiUrl(caseFiles(benchmarkId, caseId, material), machineId)}?path=${enc(path)}`,
      ),
    /** A browser-followed URL (an image, a download link), so the proxy prefix is in it. */
    caseFileUrl: (
      benchmarkId: string,
      caseId: string,
      material: CaseMaterial,
      path: string,
      machineId: string | null,
      mode: "raw" | "preview" | "download" = "raw",
    ) =>
      `${apiUrl(`${caseFiles(benchmarkId, caseId, material)}/content`, machineId)}?path=${enc(path)}` +
      (mode === "download" ? "&download=1" : mode === "preview" ? "&preview=1" : ""),
    startTask: (body: WorkbenchTaskRequest) =>
      call<TaskStartResponse>("POST", `${benchmarks}/tasks`, body),
    previewTask: (body: WorkbenchTaskRequest) =>
      call<TaskPreviewResponse>("POST", `${benchmarks}/tasks?preview=1`, body),
    /** The tasks started on one Benchmark, or every task when no Benchmark is named; newest first. */
    tasks: (benchmarkId?: string) =>
      call<TasksResponse>(
        "GET",
        benchmarkId === undefined
          ? `${benchmarks}/tasks`
          : `${benchmarks}/tasks?benchmarkId=${enc(benchmarkId)}`,
      ),
    suggestId: (body: { name: string; kind: "benchmark"; taken?: string[] }) =>
      call<SuggestIdResponse>("POST", `${project}/suggest-id`, body),
    /** Installs plugins on an Agent (the host's own route), for a task its Skills cannot run. */
    installPlugins: (agentId: string, names: string[]) =>
      call<unknown>("POST", `${project}/agents/${enc(agentId)}/plugins`, { names }),
    avatarUrl: (agentId: string, rev: string) =>
      `${project}/agents/${enc(agentId)}/avatar?rev=${enc(rev)}`,
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;

/** The viewer's preferences (the host's route). */
export const getPrefs = () => call<PrefsResponse>("GET", "/api/me/prefs");

/** Whether a Session still exists, asked of the server that holds it. */
export const getSession = (sessionId: string, machineId: string | null) =>
  call<unknown>("GET", apiUrl(`/api/sessions/${enc(sessionId)}`, machineId));

/** The approval modes a start form offers, the default first. */
export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "read-only",
  "always-ask",
  "deny-all",
];
