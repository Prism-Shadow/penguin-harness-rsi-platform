/**
 * The workbench a handler suite runs against: the real handler (workbenches/benchmark/lib/
 * workbench.ts, which index.ts hands the host), over one fake WorkbenchHost built from the types a
 * 0.2.19 server publishes (test/fixtures/harness-0.2.19/plugin.d.ts), with its folders in a temp
 * root outside any checkout.
 *
 * The fake keeps what the handler relies on and nothing else: `dataPaths()` names three folders
 * that exist, `getState`/`setState` keep one document (a copy, as the host's `state.json` would),
 * and `log` keeps its lines. The Session members are never called by this handler, so the fake
 * refuses them by name. A request is the host's `WorkbenchRequest` — the method, the path below the
 * API mount and its query, a parsed JSON body or the raw bytes of any other — and the answer is the
 * handler's `WorkbenchResponse` as it gave it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  WorkbenchHost,
  WorkbenchRequest,
  WorkbenchResponse,
} from "@prismshadow/penguin-server/plugin";
import { SEEDED_MARKER } from "../../workbenches/benchmark/lib/seeds.js";
import { createWorkbench } from "../../workbenches/benchmark/lib/workbench.js";
import workbenchPackage from "../../workbenches/benchmark/index.js";
import { entriesOf } from "./files.js";

/** A temp folder outside any checkout, removed by `dispose`. */
export async function tempRoot(prefix = "rsi-workbench-test-"): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

/** The folders of the workbench on an Agent, as the host lays them out (PRFC-0032). */
export function agentFolders(root: string, agentId = "default_agent") {
  const app = path.join(root, "projects", "p1", "agents", agentId, "app");
  return {
    dataDir: path.join(app, "data", "benchmark"),
    cacheDir: path.join(app, "cache", "benchmark"),
    stateDir: path.join(app, "state", "benchmark"),
  };
}

export interface FakeHost extends WorkbenchHost {
  /** The state document as the handler last saved it. */
  state: unknown;
  /** Every line the handler logged. */
  lines: string[];
}

/** A host whose folders are under `root`; `state` starts as given (null, as a new workbench's). */
export async function fakeHost(root: string, state: unknown = null): Promise<FakeHost> {
  const folders = agentFolders(root);
  for (const dir of Object.values(folders)) await fs.mkdir(dir, { recursive: true });
  const unused = (member: string) => () => {
    throw new Error(`the handler called host.${member}, which it has no use for`);
  };
  const host: FakeHost = {
    state,
    lines: [],
    listAgents: unused("listAgents"),
    createSession: unused("createSession"),
    run: unused("run"),
    sessionStatus: unused("sessionStatus"),
    sessionTitle: unused("sessionTitle"),
    sessionResult: unused("sessionResult"),
    subscribe: unused("subscribe"),
    socketPath: unused("socketPath"),
    dataPaths: () => ({ ...folders }),
    getState: () => structuredClone(host.state),
    setState: async (next) => {
      host.state = structuredClone(next);
    },
    log: (line) => {
      host.lines.push(line);
    },
  };
  return host;
}

/** What a suite asks with: a body for JSON, bytes for anything else. */
export interface Ask {
  body?: unknown;
  bytes?: Uint8Array;
}

export interface TestWorkbench {
  root: string;
  host: FakeHost;
  /** The workbench's data folder: where its Benchmarks are. */
  dataDir: string;
  /** Hands the handler a request as given, for one `requestOf` cannot spell. */
  handle(request: WorkbenchRequest): Promise<WorkbenchResponse>;
  /** Sends `method path?query` to the handler, as the host dispatches a request to it. */
  request(method: string, url: string, ask?: Ask): Promise<WorkbenchResponse>;
  get(url: string): Promise<WorkbenchResponse>;
  post(url: string, body?: unknown): Promise<WorkbenchResponse>;
  delete(url: string): Promise<WorkbenchResponse>;
  dispose(): Promise<void>;
}

/** The request the host hands the handler for `method url`. */
export function requestOf(method: string, url: string, ask: Ask = {}): WorkbenchRequest {
  const parsed = new URL(url, "http://workbench.invalid");
  return {
    method,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams),
    headers: ask.bytes !== undefined ? { "content-type": "application/zip" } : {},
    body: ask.body === undefined ? null : JSON.parse(JSON.stringify(ask.body)),
    ...(ask.bytes !== undefined ? { bytes: ask.bytes } : {}),
  };
}

export interface WorkbenchOptions {
  /** The seeds the first load copies; an empty folder unless given. */
  seedsDir?: string;
  /** The state document the host holds before the load. */
  state?: unknown;
  /** Load through the package's default export, with the seeds it ships, as the host does. */
  asShipped?: boolean;
}

/** A loaded workbench over a fresh temp root. */
export async function createTestWorkbench(options: WorkbenchOptions = {}): Promise<TestWorkbench> {
  const root = await tempRoot();
  const host = await fakeHost(root, options.state ?? null);
  let seedsDir = options.seedsDir;
  if (seedsDir === undefined && options.asShipped !== true) {
    seedsDir = path.join(root, "no-seeds");
    await fs.mkdir(seedsDir);
  }
  const main =
    options.asShipped === true
      ? workbenchPackage.modules.Workbench.create({ use: { host }, effect: () => {} }).api.main
      : createWorkbench(host, { seedsDir: seedsDir! });
  const request = (method: string, url: string, ask?: Ask) =>
    main.handle(requestOf(method, url, ask));
  return {
    root,
    host,
    dataDir: agentFolders(root).dataDir,
    handle: (req) => main.handle(req),
    request,
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, { body: body ?? {} }),
    delete: (url) => request("DELETE", url),
    async dispose() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** The status an answer carries; a handler that names none answers 200. */
export const statusOf = (res: WorkbenchResponse): number => res.status ?? 200;

/** The bytes of an answer read as UTF-8 text ("" for an answer that carries none). */
export const textOf = (res: WorkbenchResponse): string =>
  Buffer.from(res.bytes ?? new Uint8Array()).toString("utf8");

/**
 * The names in a workbench's data folder, sorted, but for the marker its first load leaves
 * (lib/seeds.ts): the Benchmarks, and anything a write left beside them.
 */
export async function dataEntries(dataDir: string): Promise<string[]> {
  return (await entriesOf(dataDir)).filter((name) => name !== SEEDED_MARKER);
}

/** The `{ error }` of a refusal. */
export function errorOf(res: WorkbenchResponse): {
  code: string;
  message: string;
  details?: Record<string, string>;
} {
  return (
    res.body as { error: { code: string; message: string; details?: Record<string, string> } }
  ).error;
}

/** Whether this machine can create symbolic links (Windows needs a privilege or Developer Mode). */
export async function canCreateSymlink(): Promise<boolean> {
  const dir = await tempRoot("rsi-symlink-probe-");
  try {
    await fs.symlink(dir, path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
