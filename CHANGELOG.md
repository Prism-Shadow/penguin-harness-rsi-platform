# Changelog

Each release's section is the GitHub release's notes. Versions follow semver; the harness pins one exact version.

## [0.2.0] — 2026-11-26

### Self-Evolution Workbench

The workbench is now an Agent workbench of the default Agent, in the one form every plugin app takes: a workbench folder with a handler and a page, opened in the app window ([PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/619)). The package has no server module and no code entry, and needs nothing from the host that 0.2.19 lacks.

- The package is data only: the card (category `rsi`, preinstalled on `default_agent`), the `benchmark-design` and `agent-evaluation` Skills, and the workbench `workbenches/benchmark/`. `exports` is `./format` alone. The server module, its routes, the system app, the start page's Benchmarks count, the `benchmark` id kind and the Project seed slot are gone.
- The workbench's handler (`index.ts`, compiled by the host) serves the Benchmark routes under the workbench's API mount with the requests, answers and error codes of the old `/api/projects/:projectId/benchmarks…` routes: list, create, delete, zip import (JSON or the zip itself) and export, cases a page at a time, statement and rubric files, `benchmark_busy`. Every Project member may create, delete and overwrite.
- Benchmarks belong to the Agent the workbench is installed on, in its agent-level data folder (`<agentDir>/app/data/benchmark/`): removing the workbench removes them, and an Agent export with its workbench data carries them.
- The first load writes the Example and the 18 built-in Benchmarks into the data folder and leaves `.seeded`; nothing is seeded again. `seeds/catalog.json` lists the seeds.
- Create with AI, Import, Evaluate, Optimize and Ask AI start from the page, as the person who pressed Start, through the Web App's own routes: the handler writes the prompt, the page checks the Agent's Skills (offering to install a missing one), opens the conversation with the chosen approval mode and model, sends the request and records the task with the handler. The task list reads each conversation's state as the viewer.
- A hand-made Benchmark's id is proposed from its title on the page; no model is asked.
- The page reads its Project, Agent and server from its own address and the language from its frame. An admin's page reads each machine's copy of the same workbench through the machine proxy, and a machine still on 0.2.19 at its older Project route (until 1.0). Case READMEs show diagram fences as code: the page carries no Mermaid. The page is text only, as an install copies a workbench: its fonts and pictures are inlined as data URIs.
- TOML, YAML and zip support travel in the workbench folder as TypeScript (vendored smol-toml 1.9.1 and yaml 2.9.1; a zip container over `node:zlib`). `ifaces.json` is written by core's `penguin-gen-ifaces`.
- The Skills bring in the shared Harbor adapter (harness #1662), default to `<app_data_dir>/agents/default_agent/app/data/benchmark/<benchmark_id>` and keep Harbor checkouts in the workbench's cache folder (`<agentDir>/app/cache/benchmark/harbor/`). Both are at `2026.11.26.1`; the workbench is at `2026.11.26.1`.

- 自进化工作台改为默认 Agent 的 Agent 工作台，即所有插件应用共用的那一种形式：工作台目录里有处理器与页面，在应用窗口中打开。包不带服务端模块与代码入口，也不需要 0.2.19 之外的宿主能力。
- Benchmark 归装有本工作台的 Agent 所有，存在其 agent 级数据目录；处理器沿用原数据接口的请求、应答与错误码，任何成员都可以创建、删除与覆盖导入。首次加载写入种子并留下 `.seeded`。
- 「开始」由页面以点击者的身份经 Web App 自己的接口发起；手动创建的 id 由页面按标题生成；页面不带 Mermaid。两个 Skill 合入共享的 Harbor adapter，缺省路径改为 `default_agent`，Harbor 检出改到工作台缓存目录。

### RSI toolkits

- Every toolkit's default Benchmark folder is the default Agent's Self-Evolution Workbench data folder (`…/agents/default_agent/app/data/benchmark/…`), including the demo Benchmarks APE and OPRO write. Each toolkit's Skill is at `2026.11.26.1`.
- New versions: `default-rsi-toolkit` 0.2.20; `ace-rsi-toolkit`, `ape-rsi-toolkit`, `awm-rsi-toolkit`, `opro-rsi-toolkit`, `rrsi-rsi-toolkit`, `skilladam-rsi-toolkit`, `skillopt-rsi-toolkit` and `trace-rsi-toolkit` 0.2.19-rc.2; `openskill-rsi-toolkit` 0.2.22-rc.2. `ifaces.json` is written by core 0.2.19's `penguin-gen-ifaces`.
- 各工具包的缺省 Benchmark 目录改为默认 Agent 自进化工作台的数据目录（含 APE 与 OPRO 写入演示 Benchmark 的位置），Skill 版本均为 `2026.11.26.1`，各包版本见上。

## [0.1.0] — 2026-11-25

### RSI workbench

- The RSI workbench reaches its first stable version, 0.1.0, with the content of 0.1.0-rc.2.
- RSI 工作台发布首个正式版 0.1.0，内容与 0.1.0-rc.2 相同。

### RSI toolkits

- The Default RSI toolkit reaches its stable 0.2.19 version, with the content of 0.2.19-rc.1. The other toolkits are unchanged.
- Default RSI 工具包发布正式版 0.2.19，内容与 0.2.19-rc.1 相同。其余工具包没有变化。

## [0.1.0-rc.2] — 2026-11-23

### RSI toolkits

- The RSI Platform now maintains the Default, OPRO, APE, ACE, AWM, SkillAdam, SkillOpt, OpenSkill, Trace and RRSI toolkit plugins. Each is a separate GitHub Release asset with its own package name and version.
- RSI 平台现同时维护 Default、OPRO、APE、ACE、AWM、SkillAdam、SkillOpt、OpenSkill、Trace 与 RRSI 工具包。各工具包保留独立包名和版本，在同一 GitHub Release 提供各自的安装包。

## [0.1.0-rc.1] - 2026-11-22

The first version: the harness's Evaluation Center as the external built-in plugin 「自进化工作台」 / Self-Evolution Workbench ([PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)).

- The data routes under `/api/projects/:projectId/benchmarks` (list, create, delete, zip import and export, cases and their files), moved from the harness with their requests, answers and error codes; the Benchmarks live in the folder the host names for the app (`AppData`).
- An admin's list and case list read each machine's copies apart (`?machine=<id>`) and merge them on the page as each answers, so this server's rows never wait on a machine; a Benchmark's cases are asked only of the machines that hold it.
- `GET …/benchmarks/context` and `POST` / `GET …/benchmarks/tasks`: Create with AI, Import with an Agent, Evaluate, Optimize and Ask AI start an Agent task as the person's own conversation, with the approval mode the form chose (allow-all by default); a missing Skill refuses the start and names the plugin; the tasks are recorded in the app's state folder and listed with their state.
- The page, rewritten as an iframe app (React and `@prismshadow/penguin-ui` bundled), opened in the App Center's window; it keeps its place in the window's address and opens conversations in the host.
- The `benchmark-design` and `agent-evaluation` Skills (from `@penguinharness/agent-evaluation`), version `2026.11.20.2`.
- Seeds: the Example Benchmark and the 18 built-in Benchmarks of penguin-harness-benchmark at `b44bb87`; the start page's Benchmarks count (7).
- `@penguinharness/rsi-workbench/format`: the manifest and scoreboard format, and `docs/format.md`.
