/**
 * What the page's tests share:
 *
 * - one fake server behind `fetch` (`serveProject`): the workbench's handler and the Web App's own
 *   routes the page reads, on this server and, for an admin, on each machine through the host's
 *   machine proxy (`/server/<machineId>/api/…`);
 * - one fake host window behind `window.parent` and `window.top` (`fakeHost`): its document, whose
 *   `lang` the page may read; the frame the page sits in, which it hides when it minimizes the
 *   window; the messages the page posts; and where the page sends the whole tab;
 * - the app mounted where the host serves it, the workbench's `ui/index.html`, with the language on
 *   the frame's root and the starting location in the fragment (`mountApp`);
 * - the few DOM steps a person takes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type {
  MergedBenchmark,
  MergedEvaluation,
  PromptRequest,
  PromptResponse,
  TaskRecord,
  TaskRecordRequest,
} from "../../src/api";
import type { AgentsView, ModelsView, PluginsView, SessionView } from "../../src/ui/api";
import { App } from "../../src/ui/app";
import { NAVIGATE_FALLBACK_MS } from "../../src/ui/bridge";
import { zh } from "../../src/ui/strings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The clock as it really runs, whatever a test fakes. */
const realNow = Date.now.bind(Date);

// ---------------------------------------------------------------------------- where things are

export const PROJECT_ID = "proj";
/** The Agent the workbench is installed on. */
export const AGENT_ID = "default_agent";
export const WORKBENCH_ID = "benchmark";

/** Whose workbench, on which server: `/api`, or a machine's `/server/<machineId>/api`. */
export interface Where {
  apiBase?: string;
  projectId?: string;
  agentId?: string;
  workbenchId?: string;
}

function placed(where: Where = {}): Required<Where> {
  return {
    apiBase: where.apiBase ?? "/api",
    projectId: where.projectId ?? PROJECT_ID,
    agentId: where.agentId ?? AGENT_ID,
    workbenchId: where.workbenchId ?? WORKBENCH_ID,
  };
}

const workbenchPath = (where: Where) => {
  const { apiBase, projectId, agentId, workbenchId } = placed(where);
  return `${apiBase}/projects/${projectId}/agents/${agentId}/workbenches/${workbenchId}`;
};

/** The workbench handler's API mount. */
export const handlerOf = (where: Where = {}): string => `${workbenchPath(where)}/api`;

/** The page's own address: the workbench's `ui/index.html`. */
export const pageOf = (where: Where = {}): string => `${workbenchPath(where)}/ui/index.html`;

/** A machine's API through the host's machine proxy. */
export const machineApi = (machineId: string): string => `/server/${machineId}/api`;

export const HANDLER = handlerOf();
export const BENCHMARKS = `${HANDLER}/benchmarks`;
export const PROMPT = `${HANDLER}/prompt`;
export const TASKS = `${HANDLER}/tasks`;
/** The Project's routes of the Web App on this server. */
export const PROJECT = `/api/projects/${PROJECT_ID}`;
export const agentPath = (agentId: string): string => `${PROJECT}/agents/${agentId}`;

// ---------------------------------------------------------------------------- the server

export interface SeenRequest {
  method: string;
  /** The path as asked, without the query. */
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export type Answer = (request: SeenRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function apiError(
  status: number,
  code: string,
  message = code,
  details?: Record<string, unknown>,
): Response {
  return json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, status);
}

/**
 * A server: answers by `METHOD path` (an answer may read the query), records every request, and
 * answers 404 for anything it was not told about. A later answer for the same route replaces the
 * earlier one.
 */
export class FakeServer {
  readonly requests: SeenRequest[] = [];
  readonly #answers = new Map<string, Answer>();

  /** Answers `METHOD path` with a function of the request, a fixed response, or a JSON body. */
  on(method: string, path: string, answer: Answer): this;
  on(method: string, path: string, answer: Response | object): this;
  on(method: string, path: string, answer: Answer | Response | object): this {
    this.#answers.set(
      `${method} ${path}`,
      typeof answer === "function"
        ? (answer as Answer)
        : answer instanceof Response
          ? () => answer.clone()
          : () => json(answer),
    );
    return this;
  }

  /** The requests to `METHOD path`, in order. */
  seen(method: string, path: string): SeenRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  install(): this {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        String(input instanceof Request ? input.url : input),
        window.location.origin,
      );
      const method = (init?.method ?? "GET").toUpperCase();
      const raw = init?.body;
      const request: SeenRequest = {
        method,
        path: url.pathname,
        query: url.searchParams,
        body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
      };
      this.requests.push(request);
      const answer = this.#answers.get(`${method} ${url.pathname}`);
      return answer !== undefined ? answer(request) : apiError(404, "not_found");
    });
    return this;
  }
}

/** What one machine answers for its list: its Benchmarks, a response, or one still to come. */
export type MachineList = MergedBenchmark[] | Response | (() => Promise<Response>);

const listAnswer = (list: MachineList): Response | Promise<Response> =>
  typeof list === "function"
    ? list()
    : list instanceof Response
      ? list.clone()
      : json({ benchmarks: list });

/** A machine the Project is lent to, as an admin's machine list and its own routes answer. */
export interface MachineFixture {
  /** The name it goes by on this server. */
  label: string;
  /**
   * The id of this Agent's rsi-workbench on that machine, as its App Center lists the tile; absent
   * for a machine still on 0.2.19, whose copies are read at its older Project route.
   */
  workbench?: string;
  /** Its Benchmarks (none by default), a response, or one still to come. */
  benchmarks?: MachineList;
  /** Whether the Project uses it (default true). */
  member?: boolean;
  /** Whether Penguin is installed on it (default true). */
  installed?: boolean;
}

/** Where a machine's copies are read: its workbench's handler, else its older Project route. */
export function machineBenchmarks(machineId: string, machine: Partial<MachineFixture>): string {
  const api = machineApi(machineId);
  return machine.workbench !== undefined
    ? `${handlerOf({ apiBase: api, workbenchId: machine.workbench })}/benchmarks`
    : `${api}/projects/${PROJECT_ID}/benchmarks`;
}

export interface ProjectFixture extends Where {
  isAdmin?: boolean;
  agents?: AgentsView["agents"];
  /** Each Agent's installed Skills; installing a plugin on an Agent adds the plugin's Skills. */
  skills?: Record<string, readonly string[]>;
  models?: ModelsView;
  plugins?: PluginsView;
  /** This server's Benchmarks; each has an empty case list until a test says otherwise. */
  benchmarks?: MergedBenchmark[];
  machines?: Record<string, MachineFixture>;
  /** The tasks the handler has recorded, newest first; a recorded task joins them. */
  tasks?: TaskRecord[];
  /** The conversations the viewer can read; any other answers 404. */
  sessions?: Record<string, SessionView["session"] | Response>;
  /** The id the next new conversation gets (a running one). */
  newSessionId?: string;
}

/** The prompt the fake handler writes: one line naming the kind. */
export const promptText = (kind: PromptRequest["kind"]): string => `Prompt (${kind})`;

/** The Skills the handler preselects and requires for a request, as its prompts.ts names them. */
function promptAnswer(body: PromptRequest): PromptResponse {
  const prompt = promptText(body.kind);
  switch (body.kind) {
    case "create":
      return {
        prompt,
        skills: ["benchmark-design", "agent-evaluation"],
        required: ["benchmark-design", "agent-evaluation"],
      };
    case "import":
      return { prompt, skills: ["benchmark-design"], required: [] };
    case "evaluate":
      return { prompt, skills: ["agent-evaluation"], required: ["agent-evaluation"] };
    case "optimize": {
      const skills =
        body.method === "default-rsi-toolkit"
          ? ["agent-optimization", "agent-evaluation"]
          : [body.skill ?? ""];
      return { prompt, skills, required: skills };
    }
    case "ask":
      return { prompt, skills: [], required: [] };
  }
}

/** When the fake handler records a task. */
export const RECORDED_AT = "2026-11-26T08:00:00.000Z";

/** A Project's routes: the workbench's handler, the Web App's, and each machine's. */
export function serveProject(server: FakeServer, fixture: ProjectFixture = {}): FakeServer {
  const { apiBase, projectId, agentId } = placed(fixture);
  const project = `${apiBase}/projects/${projectId}`;
  const handler = handlerOf(fixture);
  const {
    isAdmin = false,
    agents = AGENTS,
    models = MODELS,
    plugins = LIBRARY,
    benchmarks = [],
    machines = {},
    newSessionId = NEW_SESSION,
  } = fixture;
  const skills = new Map(
    Object.entries(fixture.skills ?? SKILLS).map(([id, names]) => [id, [...names]]),
  );
  const records = [...(fixture.tasks ?? [])];
  const sessions = { [newSessionId]: session({ sessionId: newSessionId }), ...fixture.sessions };

  server
    .on("GET", `${apiBase}/me`, { user: { userId: "alice", isAdmin } })
    .on("GET", `${apiBase}/me/prefs`, { prefs: {} })
    .on("GET", `${apiBase}/plugins`, plugins)
    .on("GET", `${project}/agents`, { agents })
    .on("GET", `${project}/models`, models)
    .on("GET", `${handler}/benchmarks`, { benchmarks })
    .on("POST", `${handler}/prompt`, (request) => json(promptAnswer(request.body as PromptRequest)))
    .on("GET", `${handler}/tasks`, (request) => {
      const benchmarkId = request.query.get("benchmarkId");
      return json({
        tasks:
          benchmarkId === null ? records : records.filter((r) => r.benchmarkId === benchmarkId),
      });
    })
    .on("POST", `${handler}/tasks`, (request) => {
      const task: TaskRecord = { ...(request.body as TaskRecordRequest), createdAt: RECORDED_AT };
      records.unshift(task);
      return json({ task }, 201);
    })
    .on(
      "POST",
      `${apiBase}/sessions/${newSessionId}/tasks`,
      json({ sessionId: newSessionId }, 202),
    );
  for (const benchmark of benchmarks) {
    server.on("GET", `${handler}/benchmarks/${benchmark.id}/cases`, { cases: [], total: 0 });
  }
  for (const [sessionId, answer] of Object.entries(sessions)) {
    server.on(
      "GET",
      `${apiBase}/sessions/${sessionId}`,
      answer instanceof Response ? answer : { session: answer },
    );
  }
  for (const id of new Set([...agents.map((a) => a.agentId), ...skills.keys()])) {
    const agent = `${project}/agents/${id}`;
    server
      .on("GET", `${agent}/skills`, () =>
        json({ skills: (skills.get(id) ?? []).map((name) => ({ name })) }),
      )
      .on("POST", `${agent}/plugins`, (request) => {
        const { names } = request.body as { names: string[] };
        const shipped = plugins.groups
          .flatMap((group) => group.plugins)
          .filter((plugin) => names.includes(plugin.name))
          .flatMap((plugin) => plugin.skills.map((skill) => skill.name));
        skills.set(id, [...new Set([...(skills.get(id) ?? []), ...shipped])]);
        return json({ installed: names });
      })
      .on("POST", `${agent}/sessions`, json({ session: { sessionId: newSessionId } }, 201));
  }

  server.on("GET", `${project}/machines`, {
    machines: [
      { alias: "This server", machineId: null, local: true, installed: { version: "0.4.0" } },
      ...Object.entries(machines).map(([machineId, machine]) => ({
        alias: machine.label,
        machineId,
        local: false,
        ...(machine.member !== false ? { member: true } : {}),
        installed: machine.installed === false ? null : { version: "0.4.0" },
      })),
    ],
  });
  for (const [machineId, machine] of Object.entries(machines)) {
    const center = `${machineApi(machineId)}/projects/${projectId}/app-center`;
    server
      .on("GET", center, {
        shortcuts: [
          // Tiles that are not this workbench: another Agent's copy, and another plugin's.
          { agentId: "ticket-agent", workbenchId: WORKBENCH_ID, plugin: "rsi-workbench" },
          { agentId, workbenchId: "support", plugin: "support-desk" },
          ...(machine.workbench !== undefined
            ? [{ agentId, workbenchId: machine.workbench, plugin: "rsi-workbench" }]
            : []),
        ],
      })
      .on("GET", `${center}/hidden`, { shortcuts: [] });
    const list = machineBenchmarks(machineId, machine);
    const answer = machine.benchmarks ?? [];
    server.on("GET", list, () => listAnswer(answer));
    if (Array.isArray(answer)) {
      for (const benchmark of answer) {
        server.on("GET", `${list}/${benchmark.id}/cases`, { cases: [] });
      }
    }
  }
  return server;
}

// ---------------------------------------------------------------------------- fixtures

export const AGENTS: AgentsView["agents"] = [
  { agentId: "default_agent", name: "Penguin" },
  { agentId: "ticket-agent", name: "Ticket agent" },
  { agentId: "system_agent", name: "System", system: true },
];

export const SKILLS: Record<string, readonly string[]> = {
  default_agent: [
    "agent-evaluation",
    "benchmark-design",
    "agent-optimization",
    "skillopt-rsi-toolkit",
  ],
  "ticket-agent": [],
};

export const MODELS: ModelsView = {
  defaultModel: { provider: "custom", modelId: "m-a" },
  models: ["m-a", "m-b", "m-c"].map((modelId) => ({ provider: "custom", modelId })),
};

/** The plugin library: this plugin, the default toolkit, one paper's toolkit, and one unrelated. */
export const LIBRARY: PluginsView = {
  groups: [
    {
      id: "rsi",
      plugins: [
        {
          name: "rsi-workbench",
          title: "Self-Evolution Workbench",
          skills: [{ name: "agent-evaluation" }, { name: "benchmark-design" }],
        },
        {
          name: "default-rsi-toolkit",
          title: "Default loop",
          skills: [{ name: "agent-optimization" }],
        },
        {
          name: "skillopt-rsi-toolkit",
          title: "SkillOpt",
          skills: [{ name: "skillopt-rsi-toolkit" }],
        },
      ],
    },
    { id: "dev", plugins: [{ name: "code-review", skills: [{ name: "code-review" }] }] },
  ],
};

/** The id the fake gives a new conversation. */
export const NEW_SESSION = "session-new";

export function evaluation(overrides: Partial<MergedEvaluation> = {}): MergedEvaluation {
  return {
    time: "2026-11-01T08:00:00.000Z",
    agentId: "ticket-agent",
    modelId: "m-b",
    provider: "custom",
    thinkingLevel: "medium",
    version: 1,
    score: 70,
    cost: null,
    durationMs: 1000,
    cases: [],
    machineId: null,
    ...overrides,
  };
}

export function benchmark(overrides: Partial<MergedBenchmark> = {}): MergedBenchmark {
  const evaluations = overrides.evaluations ?? [];
  return {
    id: "sec-a",
    title: "Sec A",
    status: "published",
    caseCount: 2,
    runs: 1,
    version: "2026.11.01.1",
    agentIds: [
      ...new Set(evaluations.map((e) => e.agentId).filter((a): a is string => a !== null)),
    ],
    machineIds: [null],
    ...overrides,
    evaluations,
  };
}

/** A task the handler recorded. */
export function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    sessionId: "session-1",
    kind: "evaluate",
    agentId: "default_agent",
    approvalMode: "allow-all",
    createdAt: "2026-11-20T08:00:00.000Z",
    ...overrides,
  };
}

/** A conversation as `GET /api/sessions/:id` describes it. */
export function session(overrides: Partial<SessionView["session"]> = {}): SessionView["session"] {
  return { sessionId: "session-1", status: "running", ...overrides };
}

// ---------------------------------------------------------------------------- the host

export interface FakeHost {
  /** Everything the page posted to the host, with the target origin it named. */
  posted: { message: unknown; targetOrigin: string }[];
  /** Where the page sent the whole tab itself (`window.top.location.assign`). */
  assigned: string[];
  /** The host document's root element. */
  root: HTMLElement;
  /** The frame the page sits in: `visibility: hidden` while the window is minimized. */
  frame: HTMLIFrameElement;
  /** A message from the host window (or, given `source`, from somewhere else). */
  send: (data: unknown, options?: { source?: unknown; origin?: string }) => Promise<void>;
}

let hostInPlace = false;
/** When the page last asked the host to take the viewer away (real ms), while a test runs. */
let navigatedAt: number | null = null;
/** Undoes each window stub, newest first (vitest's `parent` and `top` are plain values). */
const unstubs: (() => void)[] = [];

function stubGetter(target: object, key: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, get: () => value });
  unstubs.push(() => {
    if (own !== undefined) Object.defineProperty(target, key, own);
    else delete (target as Record<string, unknown>)[key];
  });
}

/**
 * Puts a fake host window behind `window.parent` and `window.top`, the page in a frame of it. As
 * the App Center does, it answers `penguin:navigate` by minimizing the window, which hides the
 * frame; an older host (`answersNavigate: false`) answers nothing. `lang` is its document's.
 */
export function fakeHost({
  lang,
  answersNavigate = true,
}: { lang?: string; answersNavigate?: boolean } = {}): FakeHost {
  const doc = document.implementation.createHTMLDocument("PenguinHarness");
  if (lang !== undefined) doc.documentElement.setAttribute("lang", lang);
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const posted: FakeHost["posted"] = [];
  const assigned: string[] = [];
  const host = {
    document: doc,
    location: { assign: (to: string) => void assigned.push(to) },
    postMessage: (message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
      if ((message as { type?: unknown } | null)?.type !== "penguin:navigate") return;
      navigatedAt = realNow();
      if (answersNavigate) frame.style.visibility = "hidden";
    },
  };
  stubGetter(window, "parent", host);
  stubGetter(window, "top", host);
  stubGetter(window, "frameElement", frame);
  hostInPlace = true;
  return {
    posted,
    assigned,
    root: doc.documentElement,
    frame,
    send: async (data, options = {}) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            origin: options.origin ?? window.location.origin,
            source: ("source" in options ? options.source : host) as MessageEventSource,
          }),
        );
      });
      await settle();
    },
  };
}

/** The message the page posted last, of `type`. */
export function lastPosted(host: FakeHost, kind: string): Record<string, unknown> | undefined {
  return [...host.posted]
    .reverse()
    .map((p) => p.message as Record<string, unknown>)
    .find((m) => m.type === kind);
}

// ---------------------------------------------------------------------------- mounting

const mounted: { root: Root; container: HTMLElement }[] = [];

/** Lets pending answers land and effects run. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * The app as the host frames it: the page at the workbench's `ui/index.html` (or at `path`), the
 * starting location in the fragment, and `lang` on the frame's root (none when null). A test that
 * set up no host gets one, so the page always sits in a frame.
 */
export async function mountApp({
  at = "/",
  lang = "zh-CN",
  path,
  ...where
}: Where & { at?: string; lang?: string | null; path?: string } = {}): Promise<HTMLElement> {
  if (!hostInPlace) fakeHost();
  const root = document.documentElement;
  if (lang === null) root.removeAttribute("lang");
  else root.setAttribute("lang", lang);
  window.history.replaceState(null, "", `${path ?? pageOf(where)}${at === "/" ? "" : `#${at}`}`);
  const container = document.createElement("div");
  document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => {
    reactRoot.render(createElement(App));
  });
  mounted.push({ root: reactRoot, container });
  await settle(10);
  return container;
}

/**
 * Lets a conversation opened in the test's last moments finish its fallback (bridge.ts
 * `openInHost`) while its host is still in place, so it never reaches a later test.
 */
async function drainNavigate(): Promise<void> {
  if (navigatedAt === null) return;
  if (vi.isFakeTimers()) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NAVIGATE_FALLBACK_MS);
    });
    return;
  }
  const left = NAVIGATE_FALLBACK_MS - (realNow() - navigatedAt);
  if (left >= 0) await settle(left + 10);
}

export async function unmountAll(): Promise<void> {
  await drainNavigate();
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
  for (const unstub of unstubs.splice(0).reverse()) unstub();
  hostInPlace = false;
  navigatedAt = null;
}

/** Waits until `check` holds, letting the page work in between. */
export async function waitFor(check: () => boolean, what = "the condition", timeoutMs = 3000) {
  const until = realNow() + timeoutMs;
  while (!check()) {
    if (realNow() > until) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
}

// ---------------------------------------------------------------------------- the DOM

export const text = (el: Element | null): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Whether the page shows `words` anywhere. */
export const shows = (words: string): boolean => text(document.body).includes(words);

function nameOf(el: Element): string {
  return el.getAttribute("aria-label") ?? text(el);
}

/** The button (or link) named `name`, exactly. */
export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button, a[href]")].find((el) => nameOf(el) === name);
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found as HTMLButtonElement;
}

export const hasButton = (name: string): boolean =>
  [...document.querySelectorAll("button, a[href]")].some((el) => nameOf(el) === name);

/** The card (a list item) that shows `title`. */
export function card(title: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("li")].find((li) =>
    li.textContent?.includes(title),
  );
  if (found === undefined) throw new Error(`no card ${title}`);
  return found;
}

/** The button named `name` on the card that shows `title`. */
export function cardButton(title: string, name: string): HTMLButtonElement {
  const found = [...card(title).querySelectorAll("button")].find((b) => nameOf(b) === name);
  if (found === undefined) throw new Error(`no ${name} on ${title}`);
  return found;
}

export const cardHasButton = (title: string, name: string): boolean =>
  [...card(title).querySelectorAll("button")].some((b) => nameOf(b) === name);

/** The rows of the task section titled `title`. */
export const taskRows = (title: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`ul[aria-label="${title}"] > li`),
];

export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Types `value` into a text box, the way React hears it. */
export async function type(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** The control a field label names: a text box, or a select's trigger. */
export function field(label: string): HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement {
  for (const holder of document.querySelectorAll("label, div")) {
    const title = holder.firstElementChild;
    if (title === null || text(title).replace(/\s*\*$/, "") !== label) continue;
    const control = holder.querySelector("input:not([type=file]), textarea, button[aria-haspopup]");
    if (control !== null)
      return control as HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement;
  }
  throw new Error(`no field labelled ${label}`);
}

export const hasField = (label: string): boolean => {
  try {
    field(label);
    return true;
  } catch {
    return false;
  }
};

/** Picks `option` in the select labelled `label`. */
export async function pick(label: string, option: string): Promise<void> {
  await click(field(label));
  const row = [...document.querySelectorAll('[role="option"]')].find((o) => text(o) === option);
  if (row === undefined) throw new Error(`no option ${option} in ${label}`);
  await click(row);
}

/** The text a textarea without a visible label holds: the form's prompt box. */
export function promptBox(name: string): HTMLTextAreaElement {
  const box = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${name}"]`);
  if (box === null) throw new Error(`no text box named ${name}`);
  return box;
}

// ---------------------------------------------------------------------------- Start

/** Longer than the prompt fold waits for the form to sit still. */
const PREVIEW_QUIET_MS = 350;

/** A task list's reads: the handler's records and each conversation's state. */
const isTaskListRead = (r: SeenRequest): boolean =>
  r.method === "GET" && (r.path.endsWith("/api/tasks") || /\/api\/sessions\/[^/]+$/.test(r.path));

/**
 * Presses Start once the prompt fold has asked for what the form holds, so none of its requests
 * fall among Start's; returns where Start's requests begin in `server.requests`.
 */
export async function pressStart(server: FakeServer): Promise<number> {
  await settle(PREVIEW_QUIET_MS);
  const from = server.requests.length;
  await click(button(zh.form.start));
  return from;
}

/** The requests Start made since `from`, the task lists' reads left out. */
export function startRequests(server: FakeServer, from: number): SeenRequest[] {
  return server.requests.slice(from).filter((r) => !isTaskListRead(r));
}

export interface StartCalls {
  /** `METHOD path` of each request, in order. */
  sequence: string[];
  /** `POST …/prompt`. */
  prompt: SeenRequest;
  /** `POST …/agents/:a/sessions`. */
  session: SeenRequest;
  /** `POST /api/sessions/:id/tasks`: the first message. */
  message: SeenRequest;
  /** `POST …/tasks` to the handler. */
  record: SeenRequest;
}

/** Waits until the task Start began is recorded, and names its requests. */
export async function startedTask(server: FakeServer, from: number): Promise<StartCalls> {
  const recorded = () =>
    startRequests(server, from).some((r) => r.method === "POST" && r.path === TASKS);
  await waitFor(recorded, "the task recorded");
  const calls = startRequests(server, from);
  const find = (test: (r: SeenRequest) => boolean, what: string) => {
    const found = calls.find(test);
    if (found === undefined) throw new Error(`Start sent no ${what}`);
    return found;
  };
  return {
    sequence: calls.map((r) => `${r.method} ${r.path}`),
    prompt: find((r) => r.method === "POST" && r.path === PROMPT, "prompt request"),
    session: find((r) => r.method === "POST" && r.path.endsWith("/sessions"), "new conversation"),
    message: find(
      (r) => r.method === "POST" && /^\/api\/sessions\/[^/]+\/tasks$/.test(r.path),
      "first message",
    ),
    record: find((r) => r.method === "POST" && r.path === TASKS, "record"),
  };
}

/** The text of a first message. */
export const messageText = (message: SeenRequest): string =>
  (message.body as { input: { type: string; text: string }[] }).input[0]!.text;
