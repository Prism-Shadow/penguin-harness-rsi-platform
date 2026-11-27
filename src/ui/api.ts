/**
 * The page's requests: plain same-origin `fetch` with the viewer's login cookie. The frame is
 * served from the same origin as the Web App, so the cookie and the host's same-origin write
 * check apply as they do there. Two kinds of route are asked:
 *
 * - **The workbench's handler**, under `<apiBase>/projects/<p>/agents/<a>/workbenches/<w>/api/`:
 *   the Benchmarks (`benchmarksApi`), the prompt a task sends and the tasks the page started
 *   (`workbenchApi`).
 * - **The Web App's own routes** (`hostApi`): the viewer, their preferences, the Project's Agents
 *   and models, an Agent's Skills, the plugin library and an Agent's plugin install, a new
 *   conversation and its first message, a conversation's state, and, for an admin, the machines
 *   and each machine's App Center through the host's machine proxy (`/server/<machineId>/api/…`).
 *
 * Errors arrive in the host's shape, `{ error: { code, message, details? } }`, and are thrown as
 * `ApiError` with the status, the code and the details; a request that never reached the server is
 * `network_error`.
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
  ModelRef,
  PromptRequest,
  PromptResponse,
  TaskRecordRequest,
  TaskRecordResponse,
  TasksResponse,
} from "../api";
import type { PageAddress } from "./frame-facts";

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

const enc = encodeURIComponent;

/** The workbench's API mount on the server whose API is `apiBase`. */
export function workbenchBase(
  apiBase: string,
  projectId: string,
  agentId: string,
  workbenchId: string,
): string {
  return `${apiBase}/projects/${enc(projectId)}/agents/${enc(agentId)}/workbenches/${enc(workbenchId)}/api`;
}

/**
 * The Benchmark routes under `base`: a workbench handler's `…/api/benchmarks`, or a machine's
 * older `/api/projects/<p>/benchmarks`, which answer the same paths and the same JSON. `legacy`
 * asks the older route for its own copies alone (`?local=1`), as the hub always asked it.
 */
export function benchmarksApi(base: string, legacy = false) {
  const local = (path: string) => (legacy ? `${path}?local=1` : path);
  const one = (benchmarkId: string) => `${base}/${enc(benchmarkId)}`;
  const caseFiles = (benchmarkId: string, caseId: string, material: CaseMaterial) =>
    `${one(benchmarkId)}/cases/${enc(caseId)}${material === "rubric" ? "/rubric" : ""}/files`;
  return {
    list: () => call<BenchmarksResponse>("GET", local(base)),
    create: (body: BenchmarkCreateRequest) => call<BenchmarkCreateResponse>("POST", base, body),
    remove: (benchmarkId: string) => call<void>("DELETE", one(benchmarkId)),
    importArchive: (body: BenchmarkArchiveImportRequest) =>
      call<BenchmarkArchiveImportResponse>("POST", `${base}/archive`, body),
    /** The package download: a URL the browser follows. */
    archiveUrl: (benchmarkId: string) => `${one(benchmarkId)}/archive`,
    cases: (benchmarkId: string) =>
      call<BenchmarkCasesResponse>("GET", local(`${one(benchmarkId)}/cases`)),
    casePage: (benchmarkId: string, page: number) =>
      call<BenchmarkCasesResponse>("GET", `${one(benchmarkId)}/cases?page=${page}`),
    caseFiles: (benchmarkId: string, caseId: string, material: CaseMaterial, path: string) =>
      call<CaseFilesResponse>(
        "GET",
        `${caseFiles(benchmarkId, caseId, material)}?path=${enc(path)}`,
      ),
    /** A browser-followed URL (an image, a download link). */
    caseFileUrl: (
      benchmarkId: string,
      caseId: string,
      material: CaseMaterial,
      path: string,
      mode: "raw" | "preview" | "download" = "raw",
    ) =>
      `${caseFiles(benchmarkId, caseId, material)}/content?path=${enc(path)}` +
      (mode === "download" ? "&download=1" : mode === "preview" ? "&preview=1" : ""),
  };
}

export type BenchmarksApi = ReturnType<typeof benchmarksApi>;

/** This workbench's own routes beside its Benchmarks: the prompt a task sends, and the tasks. */
export function workbenchApi(address: PageAddress) {
  const base = workbenchBase(
    address.apiBase,
    address.projectId,
    address.agentId,
    address.workbenchId,
  );
  return {
    benchmarks: benchmarksApi(`${base}/benchmarks`),
    /** What Start would send; the page posts the fields, which a long note would not fit a URL. */
    prompt: (body: PromptRequest) => call<PromptResponse>("POST", `${base}/prompt`, body),
    recordTask: (body: TaskRecordRequest) =>
      call<TaskRecordResponse>("POST", `${base}/tasks`, body),
    /** The tasks started on one Benchmark, or every task when none is named; newest first. */
    tasks: (benchmarkId?: string) =>
      call<TasksResponse>(
        "GET",
        benchmarkId === undefined
          ? `${base}/tasks`
          : `${base}/tasks?benchmarkId=${enc(benchmarkId)}`,
      ),
  };
}

export type WorkbenchApi = ReturnType<typeof workbenchApi>;

// ---------------------------------------------------------------------------
// The Web App's routes, as far as the page reads them
// ---------------------------------------------------------------------------

/** `GET /api/me`, as far as this page reads it. */
export interface MeView {
  user?: { userId?: string; isAdmin?: boolean };
}

/** `GET /api/me/prefs`, as far as this page reads it. */
export interface PrefsView {
  prefs?: { currency?: string | null };
}

/** `GET /api/projects/:p/agents`, as far as this page reads it. */
export interface AgentsView {
  agents: Array<{
    agentId: string;
    name?: string;
    description?: string;
    system?: true;
    avatarRev?: string;
  }>;
}

/** `GET /api/projects/:p/agents/:a/skills`, as far as this page reads it. */
export interface SkillsView {
  skills: Array<{ name: string }>;
}

/** `GET /api/projects/:p/models`, as far as this page reads it. */
export interface ModelsView {
  defaultModel?: ModelRef;
  models: Array<{ provider: string; modelId: string; displayName?: string }>;
}

/** One plugin of `GET /api/plugins`, as far as this page reads it. */
export interface LibraryPluginView {
  name: string;
  title?: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
  skills: Array<{ name: string }>;
  quickStart?: { skills?: string[] };
}

/** `GET /api/plugins`: the library, by category. */
export interface PluginsView {
  groups: Array<{ id: string; plugins: LibraryPluginView[] }>;
}

/** One machine of `GET /api/projects/:p/machines` (admins), as far as this page reads it. */
export interface MachineView {
  alias: string;
  machineId: string | null;
  local: boolean;
  member?: true;
  installed: { version: string } | null;
}

/** `GET /api/projects/:p/app-center`, as far as this page reads it. */
export interface AppCenterView {
  shortcuts: Array<{ agentId: string; workbenchId: string; plugin?: string }>;
}

/** `GET /api/sessions/:id`, as far as this page reads it. */
export interface SessionView {
  session: {
    sessionId: string;
    status: string;
    title?: string;
    pendingApprovalCount?: number;
  };
}

/**
 * Where the host's root is, for a page whose API is `apiBase`: `/api` and `/server/<m>/api` both
 * stand on it, and a machine's API is reached as `<root>/server/<machineId>/api`.
 */
export function hostRoot(apiBase: string): string {
  const onMachine = /\/server\/[^/]+\/api$/.exec(apiBase);
  if (onMachine !== null) return apiBase.slice(0, onMachine.index);
  return apiBase.endsWith("/api") ? apiBase.slice(0, -"/api".length) : apiBase;
}

/** The API of machine `machineId`, through the host's machine proxy. */
export function machineApiBase(apiBase: string, machineId: string): string {
  return `${hostRoot(apiBase)}/server/${enc(machineId)}/api`;
}

/** The Web App's routes the page calls, on the server whose API is `apiBase`. */
export function hostApi(apiBase: string, projectId: string) {
  const project = `${apiBase}/projects/${enc(projectId)}`;
  const agent = (agentId: string) => `${project}/agents/${enc(agentId)}`;
  return {
    me: () => call<MeView>("GET", `${apiBase}/me`),
    prefs: () => call<PrefsView>("GET", `${apiBase}/me/prefs`),
    agents: () => call<AgentsView>("GET", `${project}/agents`),
    agentSkills: (agentId: string) => call<SkillsView>("GET", `${agent(agentId)}/skills`),
    models: () => call<ModelsView>("GET", `${project}/models`),
    plugins: () => call<PluginsView>("GET", `${apiBase}/plugins`),
    machines: () => call<{ machines: MachineView[] }>("GET", `${project}/machines`),
    /** A new conversation on the Agent, as the Web App's new chat opens one. */
    createSession: (agentId: string, opts: { approvalMode: ApprovalMode; model?: ModelRef }) =>
      call<{ session: { sessionId: string } }>("POST", `${agent(agentId)}/sessions`, {
        approvalMode: opts.approvalMode,
        ...(opts.model !== undefined
          ? { provider: opts.model.provider, modelId: opts.model.modelId }
          : {}),
      }),
    /** The conversation's first message, as the Web App's Send sends one. */
    sendTask: (sessionId: string, text: string) =>
      call<{ sessionId: string }>("POST", `${apiBase}/sessions/${enc(sessionId)}/tasks`, {
        input: [{ type: "text", text }],
      }),
    session: (sessionId: string) =>
      call<SessionView>("GET", `${apiBase}/sessions/${enc(sessionId)}`),
    /** Installs plugins on an Agent, for a task its Skills cannot run. */
    installPlugins: (agentId: string, names: string[]) =>
      call<unknown>("POST", `${agent(agentId)}/plugins`, { names }),
    avatarUrl: (agentId: string, rev: string) => `${agent(agentId)}/avatar?rev=${enc(rev)}`,
  };
}

export type HostApi = ReturnType<typeof hostApi>;

/** A machine's App Center, the shown tiles and the hidden ones. */
export async function machineAppCenter(
  machineApi: string,
  projectId: string,
): Promise<AppCenterView["shortcuts"]> {
  const base = `${machineApi}/projects/${enc(projectId)}/app-center`;
  const [shown, hidden] = await Promise.all([
    call<AppCenterView>("GET", base),
    call<AppCenterView>("GET", `${base}/hidden`).catch(() => ({ shortcuts: [] })),
  ]);
  return [...(shown.shortcuts ?? []), ...(hidden.shortcuts ?? [])];
}

/** The approval modes a start form offers, the default first. */
export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "read-only",
  "always-ask",
  "deny-all",
];
