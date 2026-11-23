# 自进化工作台

[English](README.md)

`@penguinharness/rsi-workbench` 是 [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) 的「自进化工作台」：系统 Agent 的应用，用来构建 Benchmark，并以 Benchmark 测量、改进 Agent。它随 PenguinHarness 内置安装，从应用中心打开，在应用窗口中运行。

- **Benchmark**：列出、搜索、按 Agent 过滤本 Project 的 Benchmark；手动创建、从 zip 导入、导出与删除。每个 Benchmark 的页面按 Agent 与模型展示分数走势、评估记录，以及各题的题干与评分细则。
- **Agent 任务**：「用 AI 创建」「让 Agent 导入」「评估」「优化」「问 AI」点「开始」即直接发起 Agent 任务：它是你自己的对话，出现在侧栏，审批模式由你在表单里选（缺省全部允许）。工作台在每个 Benchmark 上列出由此发起的任务、状态与对话链接。
- **Skill**：`benchmark-design` 设计并校准 Benchmark，或导入已发布的包；`agent-evaluation` 执行并评分一道题。两者预装在 `default_agent` 上，RSI 工具包的优化循环以它们为测量。
- **种子**：每个新 Project 带有示例 Benchmark，以及 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 在固定提交上的内置 Benchmark。
- **格式**：`@penguinharness/rsi-workbench/format` 读写 `benchmark_config.toml` 与 `scoreboard.yaml`（[docs/format.md](docs/format.md)）。

## 接入方式

它是服务端模块插件，只用插件系统的原生接口（设计：[PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)）：

| 贡献 | 内容 |
| --- | --- |
| `HttpModule.routes` | `/api/projects/:projectId/benchmarks` 下的数据路由（与 harness 原评估中心相同）、`…/context`、`…/tasks`，以及页面文件 `/api/rsi-workbench/ui/*` |
| `WebModule.pages` | 页面 `benchmark`（`/benchmark`），以 iframe 渲染 `ui/index.html`，带 `app`（系统 Agent 的系统应用） |
| `ProjectsModule.appSeeds` | `seeds/benchmark/`，新建 Project 时由宿主复制进其数据目录 |
| `SemanticIdModule.kinds` | `benchmark` 语义 id 种类与已占用的 id |
| `SystemAppModule.apps` | 声明 `benchmark` 系统应用，其模块因此不可停用 |
| `StartPageModule.metrics` | 开始页的「评估集」计数：内置 Benchmark 取自的上游评估集个数 |
| `PluginLibraryModule.cards` / `.skills` | 卡片（分类 `rsi`，预装）与两个 Skill |

宿主只经 [`src/server/host.ts`](src/server/host.ts) 中声明的接口视图访问（`AppData`、`AgentTasks`、`ProjectAccess`、`ProjectAgents`、`AgentSkills`、`ProjectModels`、`PluginCatalog`、`ProjectMachines`、`CaseFiles`），内核按结构与宿主的接口匹配；没有这些接口的宿主加载不了本模块。

## 开发

Node 24、pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test             # vitest：格式、服务端（替身宿主）、页面（happy-dom）、Skill、脚本
pnpm build            # tsup（服务端与 ./format）→ vite（ui/）→ ifaces.json
pnpm format:check
pnpm pack:check       # 构建后：静态探测，以及两次 npm pack 的 sha512 一致
```

`scripts/gen-ifaces.mjs` 是 harness 的接口生成器（harness 提交 `b87757da8` 的 `packages/core/bin/gen-ifaces.mjs`）：已发布的 `@prismshadow/penguin-core` 0.2.18 早于它的 `penguin-gen-ifaces` 命令，故先随仓库带上；core 发布带有该命令的版本后改用它。

### 种子

`node scripts/build-seeds.mjs` 从 benchmark 仓库的 `PINNED_COMMIT`（或以 `--repo <checkout>` 指定含该提交的本地克隆）重建 `seeds/benchmark/`，并把「评估集」计数写进 `src/index.ts`；`--check` 在两者会变化时失败，CI 会运行它。移动固定提交即改变包的内容。

## 发布

给已审阅的提交打上与 `package.json` 一致的候选版本标签，例如 `v0.1.0-rc.1`。发布流程运行测试、构建，并比对两次打包的结果。上传 tarball 后，流程从 GitHub 重新下载并核对字节，再公开预发布版本。发行说明取自 CHANGELOG 对应小节。

安装包为 GitHub Release 附件 `penguinharness-rsi-workbench-<version>.tgz`。在 PenguinHarness 锁定内置工作台时，将该版本附件的下载地址与 SHA-512 完整性值登记到[插件索引](https://github.com/Prism-Shadow/penguin-harness-plugins)。

## 许可

Apache-2.0
