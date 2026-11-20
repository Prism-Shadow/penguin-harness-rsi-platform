/**
 * What the page's tests share: one fake server behind `fetch`, one fake host window behind
 * `window.parent`, the app mounted the way the host frames it (`lang` and `data-project-id` on
 * `<html>`, the starting location in the fragment), and the few DOM steps a person takes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type {
  MergedBenchmark,
  MergedEvaluation,
  WorkbenchContext,
  WorkbenchTask,
} from "../../src/api";
import { App } from "../../src/ui/app";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const PROJECT_ID = "proj";

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
 * A server for one or more Projects: answers by `METHOD path`, records every request, and answers
 * 404 for anything it was not told about.
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

const base = (projectId: string) => `/api/projects/${projectId}/benchmarks`;

/** A Project's routes: the context, the merged list, no tasks, the prefs and a prompt preview. */
export function serveProject(
  server: FakeServer,
  {
    projectId = PROJECT_ID,
    context = CONTEXT,
    benchmarks = [],
    unreachable,
    tasks = [],
  }: {
    projectId?: string;
    context?: WorkbenchContext;
    benchmarks?: MergedBenchmark[];
    unreachable?: string[];
    tasks?: WorkbenchTask[];
  } = {},
): FakeServer {
  return server
    .on("GET", "/api/me/prefs", { prefs: {} })
    .on("GET", `${base(projectId)}/context`, { ...context, projectId })
    .on("GET", base(projectId), {
      benchmarks,
      ...(unreachable !== undefined ? { unreachable } : {}),
    })
    .on("GET", `${base(projectId)}/tasks`, { tasks })
    .on("POST", `${base(projectId)}/tasks`, (request: SeenRequest) =>
      request.query.get("preview") === "1"
        ? json({ prompt: `Prompt for ${JSON.stringify(request.body)}`, skills: [] })
        : json(
            { task: task({ kind: (request.body as { kind: WorkbenchTask["kind"] }).kind }) },
            201,
          ),
    );
}

// ---------------------------------------------------------------------------- fixtures

export const CONTEXT: WorkbenchContext = {
  projectId: PROJECT_ID,
  role: "owner",
  isAdmin: false,
  dir: "/srv/penguin/projects/proj/benchmarks",
  agents: [
    {
      agentId: "default_agent",
      name: "Penguin",
      skills: [
        "agent-evaluation",
        "benchmark-design",
        "agent-optimization",
        "skillopt-rsi-toolkit",
      ],
    },
    { agentId: "ticket-agent", name: "Ticket agent", skills: [] },
  ],
  defaultAgentId: "default_agent",
  models: ["m-a", "m-b", "m-c"].map((modelId) => ({ provider: "custom", modelId })),
  defaultModel: { provider: "custom", modelId: "m-a" },
  methods: [
    {
      plugin: "default-rsi-toolkit",
      kind: "default",
      skill: "agent-optimization",
      label: "Default loop",
      labelZh: "Default loop",
      hint: "",
      hintZh: "",
    },
    {
      plugin: "skillopt-rsi-toolkit",
      kind: "paper",
      skill: "skillopt-rsi-toolkit",
      label: "SkillOpt",
      labelZh: "SkillOpt",
      hint: "",
      hintZh: "",
    },
  ],
  machines: [],
};

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

export function task(overrides: Partial<WorkbenchTask> = {}): WorkbenchTask {
  return {
    sessionId: "session-1",
    kind: "evaluate",
    agentId: "default_agent",
    userId: "alice",
    approvalMode: "allow-all",
    createdAt: "2026-11-20T08:00:00.000Z",
    state: "running",
    pendingApprovals: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------- the host

export interface FakeHost {
  /** Everything the page posted to the host, with the target origin it named. */
  posted: { message: unknown; targetOrigin: string }[];
  /** A message from the host window (or, given `source`, from somewhere else). */
  send: (data: unknown, options?: { source?: unknown; origin?: string }) => Promise<void>;
}

/** Puts a fake host window behind `window.parent`. */
export function fakeHost(): FakeHost {
  const posted: FakeHost["posted"] = [];
  const host = {
    postMessage: (message: unknown, targetOrigin: string) => posted.push({ message, targetOrigin }),
  };
  try {
    vi.spyOn(window, "parent", "get").mockReturnValue(host as unknown as Window);
  } catch {
    Object.defineProperty(window, "parent", { configurable: true, get: () => host });
  }
  return {
    posted,
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

// ---------------------------------------------------------------------------- mounting

const mounted: { root: Root; container: HTMLElement }[] = [];

/** Lets pending answers land and effects run. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The app as the host frames it: language, Project and starting location on the document. */
export async function mountApp({
  at = "/",
  lang = "zh-CN",
  projectId = PROJECT_ID,
}: { at?: string; lang?: string; projectId?: string | null } = {}): Promise<HTMLElement> {
  const root = document.documentElement;
  root.setAttribute("lang", lang);
  if (projectId === null) root.removeAttribute("data-project-id");
  else root.setAttribute("data-project-id", projectId);
  window.history.replaceState(
    null,
    "",
    `/api/rsi-workbench/ui/index.html${at === "/" ? "" : `#${at}`}`,
  );
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

export async function unmountAll(): Promise<void> {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.innerHTML = "";
}

/** Waits until `check` holds, letting the page work in between. */
export async function waitFor(check: () => boolean, what = "the condition", timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
}

// ---------------------------------------------------------------------------- the DOM

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

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

/** Every button named `name`. */
export const buttons = (name: string): HTMLButtonElement[] =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].filter((el) => nameOf(el) === name);

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

/** The message the page posted last, of `type`. */
export function lastPosted(host: FakeHost, kind: string): Record<string, unknown> | undefined {
  return [...host.posted]
    .reverse()
    .map((p) => p.message as Record<string, unknown>)
    .find((m) => m.type === kind);
}
