# 自进化工作台

[English](README.md)

`@penguinharness/rsi-workbench` 是 [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) 的「自进化工作台」：默认 Agent 的工作台，用来构建 Benchmark，并以 Benchmark 测量、改进 Agent。它随 PenguinHarness 内置安装，预装在每个新 Project 的 `default_agent` 上，与其他 Agent 工作台一样从应用中心打开，在应用窗口中运行。

平台也维护 `plugins/` 下的 RSI 工具包。每个工具包保留自己的插件卡片和 Skill，作为独立的 `penguinharness-<工具包>-<包版本>.tgz` 随同一 Release 发布。

- **Benchmark**：列出、搜索、按 Agent 过滤装有本工作台的 Agent 的 Benchmark；手动创建、从 zip 导入、导出与删除。每个 Benchmark 的页面按 Agent 与模型展示分数走势、评估记录，以及各题的题干与评分细则。Project 的任何成员都可以创建、删除与覆盖导入。
- **Agent 任务**：「用 AI 创建」「让 Agent 导入」「评估」「优化」「问 AI」点「开始」即直接发起 Agent 任务：它是你自己的对话，出现在侧栏，审批模式由你在表单里选（缺省全部放行）。页面以与 Web App「发送」相同的方式发起任务，并在每个 Benchmark 上列出由此发起的任务、状态与对话链接。
- **Skill**：`benchmark-design` 设计并校准 Benchmark，或导入已发布的包；`agent-evaluation` 执行并评分一道题。两者预装在 `default_agent` 上，RSI 工具包的优化循环以它们为测量。
- **种子**：工作台首次加载时，把示例 Benchmark 与 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) 在固定提交上的内置 Benchmark 写入自己的数据目录，只写一次。
- **格式**：`@penguinharness/rsi-workbench/format` 读写 `benchmark_config.toml` 与 `scoreboard.yaml`（[docs/format.md](docs/format.md)）。

## 接入方式

包只有数据：没有服务端模块，没有代码入口，宿主也不为它新增能力（设计：[PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/619)）。`src/index.ts` 向插件库贡献：

| 贡献 | 内容 |
| --- | --- |
| `PluginLibraryModule.cards` | 卡片，分类 `rsi`，预装到 `default_agent` |
| `PluginLibraryModule.skills` | `benchmark-design` 与 `agent-evaluation` |
| `PluginLibraryModule.workbenches` | 工作台目录 `workbenches/benchmark/`，安装时复制进 Agent 的 `agent_state/workbenches/benchmark/` |

工作台目录就是工作台运行时的全部，它需要的一切都在其中：

| 路径 | 内容 |
| --- | --- |
| `package.json` | 清单：一个 `Workbench` 模块，requires 宿主的 `WorkbenchHost`、provides `WorkbenchMain`，贡献一个标签页，以 iframe 渲染 `ui/index.html` |
| `index.ts` | 处理器，由宿主编译：工作台接口下的 Benchmark 路由，数据存在其 agent 级数据目录（`<agentDir>/app/data/benchmark/`）；各任务发送的提示词；页面发起的任务（记在工作台状态里）；首次加载时写入的种子 |
| `lib/` | 处理器的模块：`format/`（`./format` 的副本，由 `scripts/copy-format.mjs` 写出）、`vendor/`（smol-toml 与 yaml 的 TypeScript 源码及其许可）、基于 `node:zlib` 的 zip 容器 |
| `ui/` | 页面，由 Vite 构建（打包 React 与 `@prismshadow/penguin-ui`，不含 Mermaid；只有文本文件，字体与图片内联）：从自己的地址读出 Project、Agent 与服务端，以打开它的人的身份调用处理器与 Web App 自己的接口 |
| `seeds/` | 种子 Benchmark 与 `catalog.json`（供 harness 的组件画廊与官网列出） |

管理员的页面另经宿主的机器代理读取各机器上同一 Agent 的工作台副本，按 id 合并；尚未升级的机器改读它旧的 `/api/projects/:projectId/benchmarks` 接口（兼容代码，留到 1.0）。

## 开发

Node 24、pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # 格式副本是最新的、tsc（包、处理器、页面）、按宿主选项编译处理器、各工具包
pnpm test             # vitest：格式、处理器（替身宿主）、页面（happy-dom）、Skill、脚本
pnpm build            # tsup（./format）→ vite（workbenches/benchmark/ui/）→ lib/format → ifaces.json → 工具包
pnpm format:check
pnpm pack:check       # 构建后：静态探测，以及两次 npm pack 的 sha512 一致
```

`scripts/check-workbench.mjs`（属于 `typecheck`）按宿主的方式编译 `workbenches/benchmark/index.ts`——`strict`、`module: NodeNext`、只用 `@types/node`——所用的类型是 0.2.19 服务端写进工作台目录的那一份（`test/fixtures/harness-0.2.19/plugin.d.ts`），然后加载编译结果，列出写入的种子 Benchmark。`ifaces.json` 由 `@prismshadow/penguin-core` 的 `penguin-gen-ifaces` 命令生成。

### 种子

`node scripts/build-seeds.mjs` 从 benchmark 仓库的 `PINNED_COMMIT`（或以 `--repo <checkout>` 指定含该提交的本地克隆）重建 `workbenches/benchmark/seeds/` 及其 `catalog.json`；`--check` 在两者会变化时失败，CI 会运行它。移动固定提交即改变包的内容。

## 发布

给已审阅的提交打上与 `package.json` 版本一致的标签：`v0.1.0-rc.1` 是候选版本，`v0.1.0` 是正式版本。发布流程运行测试、构建，并比对两次打包的结果。上传 tarball 后，流程从 GitHub 重新下载并核对字节，再公开这次发布；候选版本以预发布形式公开。发行说明取自 CHANGELOG 对应小节。

仓库变量 `NPM_TRUSTED_PUBLISHING` 为 `true` 时，流程还会通过可信发布把这次发布的 tarball 推送到 npm：正式版本进入 `latest`，预发布版本进入 `rc` 标签。npm 上已有的版本会跳过，但内容必须一致。新的包名需要先用发布附件手动发布一次，再在 npm 上把本流程和 `npm` 环境设为它的可信发布者。如需把已有发布的 tarball 补发到 npm 而不打新标签，可手动运行工作流并指定标签：`gh workflow run release.yml --ref main -f tag=v0.1.0`；可选的 `skip` 输入列出要跳过的包名。

安装包为 GitHub Release 附件 `penguinharness-rsi-workbench-<version>.tgz`。在 PenguinHarness 锁定内置工作台时，将该版本附件的下载地址与 SHA-512 完整性值登记到[插件索引](https://github.com/Prism-Shadow/penguin-harness-plugins)。

## 许可

Apache-2.0
