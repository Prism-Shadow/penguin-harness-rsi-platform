# Self-Evolution Workbench

[中文](README.zh.md)

`@penguinharness/rsi-workbench` is the Self-Evolution Workbench of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness): the system Agent's app for building Benchmarks and measuring and improving Agents against them. It ships built in with PenguinHarness, opens from the App Center, and runs in the App Center's window.

The platform also maintains the RSI toolkit plugins under `plugins/`. Each toolkit ships in the same release as a separate `penguinharness-<toolkit>-<package-version>.tgz` with its own library card and Skills.

- **Benchmarks.** List, search and filter the Project's Benchmarks, create one by hand, import a package from a zip, export one, or delete it. Each Benchmark's page shows its score history per Agent and model, its evaluations, and its cases' statements and rubrics.
- **Agent tasks.** Create with AI, Import with an Agent, Evaluate, Optimize and Ask AI start an Agent task straight away, as your own conversation in the sidebar, with the approval mode you choose (allow-all unless you pick another). The workbench lists the tasks it started on each Benchmark, with their state and a link to the conversation.
- **Skills.** `benchmark-design` designs and calibrates a Benchmark or imports a published package; `agent-evaluation` runs and scores one case. Both are preinstalled on `default_agent`, and the RSI toolkits' optimization loops measure through them.
- **Seeds.** Every new Project starts with the Example Benchmark and the built-in Benchmarks of [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) at a pinned commit.
- **Format.** `@penguinharness/rsi-workbench/format` reads and writes `benchmark_config.toml` and `scoreboard.yaml` ([docs/format.md](docs/format.md)).

## How it plugs in

It is a server-module plugin that uses only the plugin system's own interfaces (design: [PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)):

| Contribution | What it is |
| --- | --- |
| `HttpModule.routes` | the data routes under `/api/projects/:projectId/benchmarks` (unchanged from the harness's Evaluation Center), `…/context`, `…/tasks`, and `/api/rsi-workbench/ui/*` (the page's files) |
| `WebModule.pages` | page `benchmark` at `/benchmark`, drawn as an iframe of `ui/index.html`, with `app` (a system app of the system Agent) |
| `ProjectsModule.appSeeds` | `seeds/benchmark/`, copied into a new Project's data folder by the host |
| `SemanticIdModule.kinds` | the `benchmark` id kind and its taken ids |
| `SystemAppModule.apps` | declares the `benchmark` system app, so its module cannot be stopped |
| `StartPageModule.metrics` | the start page's Benchmarks count: the upstream suites the built-in Benchmarks come from |
| `PluginLibraryModule.cards` / `.skills` | the card (category `rsi`, preinstalled) and the two Skills |

The host is reached only through the interfaces declared in [`src/server/host.ts`](src/server/host.ts) (`AppData`, `AgentTasks`, `ProjectAccess`, `ProjectAgents`, `AgentSkills`, `ProjectModels`, `PluginCatalog`, `ProjectMachines`, `CaseFiles`), which the kernel matches to the host's by structure. A host without them cannot load the module.

## Development

Node 24 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test             # vitest: format, server (over a fake host), the page (happy-dom), Skills, scripts
pnpm build            # tsup (server, ./format) → vite (ui/) → ifaces.json
pnpm format:check
pnpm pack:check       # after build: the static probe, and npm pack twice with equal sha512
```

`scripts/gen-ifaces.mjs` is the harness's interface generator (`packages/core/bin/gen-ifaces.mjs` at harness commit `b87757da8`), vendored because the published `@prismshadow/penguin-core` 0.2.18 predates its `penguin-gen-ifaces` bin; the build switches to the bin once a core release carries it.

### Seeds

`node scripts/build-seeds.mjs` rebuilds `seeds/benchmark/` from the benchmark repository at `PINNED_COMMIT` (or `--repo <checkout>` for a local clone that has the commit) and writes the Benchmarks count into `src/index.ts`. `--check` fails when either would change; CI runs it. Moving the pin is a change to the package's content.

## Release

Tag the reviewed commit with `v<version>` to match the release candidate in `package.json`, for example `v0.1.0-rc.1`. The workflow tests and builds the package, compares two independent packs, then downloads the attached tarball and checks its bytes before publishing the GitHub prerelease. Its notes come from the matching CHANGELOG section.

Use the release asset `penguinharness-rsi-workbench-<version>.tgz`. Register its versioned GitHub download URL and SHA-512 integrity in the [plugin index](https://github.com/Prism-Shadow/penguin-harness-plugins) when pinning the built-in workbench in PenguinHarness.

## License

Apache-2.0
