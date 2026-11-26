// The `@prismshadow/penguin-server/plugin` a 0.2.19 server writes into a workbench folder
// (`.harness/plugin.d.ts`): its renderDts over the interface table the published
// @prismshadow/penguin-server@0.2.19 carries (table da3633d95d3203fabc9300a7cb3fb3318da9885183d8b47ef8a74f01963931e1),
// keys WorkbenchHost and WorkbenchMain. The published package exports no workbench types of its
// own, so scripts/check-workbench.mjs and the tsconfig `paths` compile the handler against this.

type Opaque<Name extends string> = { readonly __opaque: Name };
export type Array_agentId_string = Array<{ agentId: (string) }>;
export type WorkbenchApprovalMode = ('allow-all'|'deny-all');
export type Array_WorkbenchInput = Array<WorkbenchInput>;
export type WorkbenchInput = { text: (string) };
export type WorkbenchResult = { status: ('running'|'failed'|'completed'); text: (string); error: (null|string) };
export type WorkbenchRecord = { timestamp: (string); type: (string); payload: { [key: string]: (unknown); type?: (string) }; origin?: Array_string };
export type Array_string = (string[]);
export type WorkbenchDataLevel = ('agent'|'server'|'machine');
export type WorkbenchDataPaths = { dataDir: (string); cacheDir: (string); stateDir: (string) };
export interface WorkbenchHost {
  listAgents: () => Array_agentId_string;
  createSession: (a0?: ({ agentId?: (string); model?: { provider: (string); modelId: (string) }; approvalMode?: WorkbenchApprovalMode } | (undefined))) => Promise<{ sessionId: (string) }>;
  run: (a0: (string), a1: Array_WorkbenchInput) => Promise<{ sessionId: (string); queued: (boolean) }>;
  sessionStatus: (a0: (string)) => (string);
  sessionTitle: (a0: (string)) => (null|string);
  sessionResult: (a0: (string)) => Promise<WorkbenchResult>;
  subscribe: (a0: (string), a1: ((a0: WorkbenchRecord) => void)) => (() => void);
  dataPaths: (a0?: (WorkbenchDataLevel | (undefined))) => WorkbenchDataPaths;
  socketPath: (a0: (string), a1?: (WorkbenchDataLevel | (undefined))) => (string);
  getState: () => (unknown);
  setState: (a0: (unknown)) => Promise<void>;
  log: (a0: (string)) => void;
}
export type Record_string_string = { [key: string]: (string) };
export interface WorkbenchMain {
  handle: (a0: { method: (string); path: (string); query: Record_string_string; headers: Record_string_string; body: (unknown); bytes?: Uint8Array }) => Promise<{ status?: (number); headers?: Record_string_string; body?: (unknown); bytes?: Uint8Array; stream?: AsyncIterable<((string) | Uint8Array)> }>;
}

export type WorkbenchRequest = Parameters<WorkbenchMain["handle"]>[0];
export type WorkbenchResponse = Awaited<ReturnType<WorkbenchMain["handle"]>>;
export interface WorkbenchModuleCtx<Use> {
  use: Use;
  /** Runs when the tree is disposed (a reload, a removal, the platform going away). */
  effect(dispose: () => void): void;
}
export interface WorkbenchRootModule {
  create(ctx: WorkbenchModuleCtx<{ host: WorkbenchHost }>): {
    api: { main: WorkbenchMain } & Record<string, unknown>;
  };
}
/** Any other module of the package: what it uses is whatever its own manifest requires. */
export interface WorkbenchModule {
  create(ctx: WorkbenchModuleCtx<Record<string, unknown>>): { api?: Record<string, unknown> };
}
/** The default export of index.ts: `export default { … } satisfies WorkbenchPackage`. */
export interface WorkbenchPackage {
  modules: { Workbench: WorkbenchRootModule; [name: string]: WorkbenchRootModule | WorkbenchModule };
}
