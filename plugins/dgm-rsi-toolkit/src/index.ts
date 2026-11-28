import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "dgm-rsi-toolkit.card",
        title: "DGM RSI Toolkit",
        titleZh: "DGM 自进化工具包",
        descriptionZh:
          "DGM RSI 工具包：按论文《Darwin Gödel Machine》（Sakana AI，2025，https://arxiv.org/abs/2505.22954）的流程运行——档案保存 Target 的 harness 变体，父代按分数与多样性从档案中抽取，新的 Modifier 会话把父代的文件改成候选，每个候选都在冻结的 Benchmark 上测量，被采纳的变体进入档案继续开放式多分支搜索。自成一体：自行创建 Target 的 harness 槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "DGM RSI Toolkit: open-ended archive-based self-improvement.",
        shortDescriptionZh: "DGM RSI 工具包：档案式开放式自进化。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `dgm-rsi-toolkit` Skill to reproduce DGM on the precise-summary demo task that ships with it: create the Target agent `summary_writer`, initialize the harness package, measure H_0, run two generations of parent selection and Modifier proposals, restore the best variant and report the archive with both matrices.",
          promptZh:
            "使用 `dgm-rsi-toolkit` 技能在它自带的「精确摘要」演示任务上复现 DGM：创建 Target 智能体 `summary_writer`，初始化 harness 包，测量 H_0，跑两代父代选择与 Modifier 提案，恢复最佳变体并报告档案与两轮矩阵。",
          skills: ["dgm-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2505.22954", "https://sakana.ai/dgm"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "dgm-rsi-toolkit.skill.dgm-rsi-toolkit",
        name: "dgm-rsi-toolkit",
        path: "skills/dgm-rsi-toolkit",
      },
    ],
  },
})
export class DgmRsiToolkitPlugin {}

export default { modules: [DgmRsiToolkitPlugin] } satisfies Plugin;
