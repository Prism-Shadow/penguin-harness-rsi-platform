/**
 * @penguinharness/rsi-workbench — the Self-Evolution Workbench (PRFC-0036): a workbench of the
 * default Agent for designing, importing, evaluating and optimizing Agents against Benchmarks.
 *
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`, which the
 * library reads without running anything.
 *
 *   PluginLibraryModule.cards       the card, in the `rsi` category; preinstalled on default_agent
 *   PluginLibraryModule.skills      benchmark-design and agent-evaluation
 *   PluginLibraryModule.workbenches the workbench folder `workbenches/benchmark/`: its handler
 *                                   (`index.ts`, which keeps the Benchmarks in the workbench's
 *                                   agent-level data folder), its page (`ui/`) and its seeds
 *
 * The package also exports, as subpaths of its own (it has no `.` export): `./format`, the
 * Benchmark manifest and scoreboard format, which the workbench's handler carries a copy of
 * (`workbenches/benchmark/lib/format/`); `./api` and `./prompts`, the handler's HTTP contract and
 * the prompts its tasks send, built from the workbench folder's own modules; and the folder's files.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "rsi-workbench.card",
        title: "Self-Evolution Workbench",
        titleZh: "自进化工作台",
        descriptionZh:
          "默认 Agent 的自进化工作台：在应用窗口里管理这个 Agent 的 Benchmark——手动创建、用 AI 设计并校准、导入与导出——并一键发起评估与优化，任务作为你的对话出现在侧栏；附带 benchmark-design 与 agent-evaluation 两个 Skill，RSI 工具包的优化循环以这些测量为准。",
        shortDescription:
          "The default Agent's workbench: create, import, evaluate and optimize Agents against Benchmarks.",
        shortDescriptionZh: "默认 Agent 的工作台：创建、导入 Benchmark，评估并优化 Agent。",
        category: "rsi",
        icon: "icon.svg",
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
    "PluginLibraryModule.workbenches": [
      { id: "rsi-workbench.workbench.benchmark", name: "benchmark", path: "workbenches/benchmark" },
    ],
  },
})
export class RsiWorkbenchPlugin {}

export default { modules: [RsiWorkbenchPlugin] } satisfies Plugin;
