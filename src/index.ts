/**
 * @penguinharness/rsi-workbench — the Self-Evolution Workbench: the system Agent's
 * app for designing, importing, evaluating and optimizing Agents against Benchmarks (PRFC-0036).
 * It was the harness's built-in Evaluation Center; it is a server-module plugin over the plugin
 * system's own interfaces, with no part of it built into the Web App:
 *
 *   PluginLibraryModule.cards / .skills   the card and the benchmark-design and agent-evaluation
 *                                         Skills (preinstalled on default_agent)
 *   HttpModule.routes                     the data routes, the page's context and its Agent tasks
 *                                         (server/routes.ts), and the page's files (ui-files.ts)
 *   WebModule.pages                       the page, drawn as an iframe of `ui/index.html` and
 *                                         carrying `app`: a system app of the system Agent, which
 *                                         the Web App opens in the App Center's window
 *   ProjectsModule.appSeeds               the example and built-in Benchmarks (`seeds/benchmark/`),
 *                                         copied into a new Project's data folder by the host
 *   SemanticIdModule.kinds                the `benchmark` id kind, with the ids already taken
 *   SystemAppModule.apps                  this module provides the `benchmark` system app, so it
 *                                         cannot be stopped
 *   StartPageModule.metrics               the start page's Benchmarks count: the upstream benchmark
 *                                         suites the built-in Benchmarks come from (written by
 *                                         scripts/build-seeds.mjs)
 *
 * The host is reached only through the interfaces declared in server/host.ts. A host without
 * AppData or AgentTasks cannot satisfy them, so the module does not load there.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { Hono } from "hono";
import {
  AgentSkills,
  AgentTasks,
  AppData,
  CaseFiles,
  PluginCatalog,
  ProjectAccess,
  ProjectAgents,
  ProjectMachines,
  ProjectModels,
} from "./server/host.js";
import { workbenchRoutes, type RouteEnv } from "./server/routes.js";
import { BenchmarkStore } from "./server/service.js";
import { TaskLog } from "./server/tasks.js";
import { uiRoutes } from "./server/ui-files.js";

/** The app id: the page key, the App Center arrangement key's suffix and the data folder's name. */
export const APP_ID = "benchmark";

/** The package's root folder, beside `dist/` (and beside `src/` when run from source). */
const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The code half of the `benchmark` semantic-id kind: the ids a new Benchmark may not take. */
export interface TakenBenchmarkIds {
  takenIds(projectId: string): Promise<string[]>;
}

/** The card and the Skills, for the plugin library. Data only. */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "rsi-workbench.card",
        title: "Self-Evolution Workbench",
        titleZh: "自进化工作台",
        descriptionZh:
          "自进化工作台：在应用中心的窗口里管理 Benchmark——手动创建、用 AI 设计并校准、导入与导出——并一键发起评估与优化的 Agent 任务，任务作为你的对话出现在侧栏；附带 benchmark-design 与 agent-evaluation 两个 Skill，RSI 工具包的优化循环以这些测量为准。",
        shortDescription:
          "Create, import, evaluate and optimize Agents against Benchmarks, from the App Center.",
        shortDescriptionZh: "在应用中心创建、导入 Benchmark，评估并优化 Agent。",
        category: "rsi",
        icon: "icon.svg",
        preinstall: true,
        quickStart: {
          prompt:
            "List the Benchmark packages in Prism-Shadow/penguin-harness-benchmark and tell me in one line each what they measure. Import nothing until I pick one.",
          promptZh:
            "列出 Prism-Shadow/penguin-harness-benchmark 里的 Benchmark 包，每个用一句话说明它测什么。我选定之前不要导入任何一个。",
          skills: ["benchmark-design"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "rsi-workbench.skill.agent-evaluation",
        name: "agent-evaluation",
        path: "skills/agent-evaluation",
      },
      {
        id: "rsi-workbench.skill.benchmark-design",
        name: "benchmark-design",
        path: "skills/benchmark-design",
      },
    ],
  },
})
export class RsiWorkbenchLibrary {}

/** The app: its routes, its page, its seeds, its id kind, and what it declares to the host. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "rsi-workbench.routes",
        prefix: "/api/projects/:projectId/benchmarks",
        auth: "user",
        order: 160,
      },
      {
        id: "rsi-workbench.ui",
        prefix: "/api/rsi-workbench/ui",
        auth: "user",
        order: 161,
      },
    ],
    "WebModule.pages": [
      {
        id: "rsi-workbench.page",
        key: "benchmark",
        path: "/benchmark",
        nav: "none",
        admin: false,
        renderer: {
          iframe: { src: "/api/rsi-workbench/ui/index.html", namespace: "rsi-workbench" },
        },
        title: "Self-Evolution Workbench",
        titleZh: "自进化工作台",
        icon: "trophy",
        app: { order: 50 },
      },
    ],
    "ProjectsModule.appSeeds": [
      { id: "rsi-workbench.seeds.benchmark", app: "benchmark", path: "seeds/benchmark" },
    ],
    // Writing a Benchmark by hand is Project management: owner only, as the create route demands.
    "SemanticIdModule.kinds": [
      { id: "rsi-workbench.semantic-id.benchmark", kind: "benchmark", access: "owner" },
    ],
    "SystemAppModule.apps": [{ id: "rsi-workbench.system-app.benchmark", app: "benchmark" }],
    "StartPageModule.metrics": [
      {
        id: "rsi-workbench.metric.benchmarks",
        key: "benchmarks",
        title: "Benchmarks",
        titleZh: "评估集",
        icon: "trophy",
        order: 50,
        // build-seeds:suites — the distinct upstream suites of seeds/benchmark/ (scripts/build-seeds.mjs)
        value: 7,
        app: "benchmark",
      },
    ],
  },
})
export class RsiWorkbenchApp {
  @Use() private readonly appData!: AppData;
  @Use() private readonly access!: ProjectAccess;
  @Use() private readonly agents!: ProjectAgents;
  @Use() private readonly skills!: AgentSkills;
  @Use() private readonly models!: ProjectModels;
  @Use() private readonly library!: PluginCatalog;
  @Use() private readonly machines!: ProjectMachines;
  @Use() private readonly files!: CaseFiles;
  @Use() private readonly tasks!: AgentTasks;
  @Bind("rsi-workbench.routes") routes!: Hono<RouteEnv>;
  @Bind("rsi-workbench.ui") ui!: Hono<RouteEnv>;
  @Bind("rsi-workbench.semantic-id.benchmark") benchmarkIds!: TakenBenchmarkIds;

  setup() {
    const appData = this.appData;
    const dirOf = async (projectId: string) => (await appData.dataPaths(projectId, APP_ID)).dataDir;
    const store = new BenchmarkStore({ dirOf, files: this.files });
    this.routes = workbenchRoutes({
      store,
      dirOf,
      access: this.access,
      agents: this.agents,
      skills: this.skills,
      models: this.models,
      library: this.library,
      machines: this.machines,
      tasks: this.tasks,
      log: new TaskLog(async (projectId) => (await appData.dataPaths(projectId, APP_ID)).stateDir),
    });
    this.ui = uiRoutes(path.join(PACKAGE_ROOT, "ui"));
    this.benchmarkIds = { takenIds: (projectId) => store.takenIds(projectId) };
  }
}

const plugin: Plugin = { modules: [RsiWorkbenchLibrary, RsiWorkbenchApp] };
export default plugin;
