# Self-Evolution Workbench

[中文](README.zh.md)

`@penguinharness/rsi-workbench` is the Self-Evolution Workbench of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness): a workbench of the default Agent for building Benchmarks and measuring and improving Agents against them. It ships built in with PenguinHarness, is preinstalled on every new Project's `default_agent`, and opens from the App Center in the app window, like any other Agent workbench.

The platform also maintains the RSI toolkit plugins under `plugins/`. Each toolkit ships in the same release as a separate `penguinharness-<toolkit>-<package-version>.tgz` with its own library card and Skills.

- **Benchmarks.** List, search and filter the Benchmarks of the Agent the workbench is installed on, create one by hand, import a package from a zip, export one, or delete it. Each Benchmark's page shows its score history per Agent and model, its evaluations, and its cases' statements and rubrics. Every Project member may create, delete and overwrite.
- **Agent tasks.** Create with AI, Import with an Agent, Evaluate, Optimize and Ask AI start an Agent task straight away, as your own conversation in the sidebar, with the approval mode you choose (allow-all unless you pick another). The page starts it the way the Web App's Send does, and lists the tasks it started on each Benchmark, with their state and a link to the conversation.
- **Skills.** `benchmark-design` designs and calibrates a Benchmark or imports a published package; `agent-evaluation` runs and scores one case. Both are preinstalled on `default_agent`, and the RSI toolkits' optimization loops measure through them.
- **Seeds.** The first time the workbench loads, it writes the Example Benchmark and the built-in Benchmarks of [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark) at a pinned commit into its data folder, once.
- **Format.** `@penguinharness/rsi-workbench/format` reads and writes `benchmark_config.toml` and `scoreboard.yaml` ([docs/format.md](docs/format.md)).

## How it plugs in

The package is data only: no server module, no code entry, nothing the host adds for it (design: [PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/619)). `src/index.ts` contributes, for the plugin library:

| Contribution | What it is |
| --- | --- |
| `PluginLibraryModule.cards` | the card, category `rsi`, preinstalled on `default_agent` |
| `PluginLibraryModule.skills` | `benchmark-design` and `agent-evaluation` |
| `PluginLibraryModule.workbenches` | the workbench folder `workbenches/benchmark/`, which an install copies into the Agent's `agent_state/workbenches/benchmark/` |

The workbench folder is all the workbench has at runtime, so everything it needs is inside it:

| Path | What it is |
| --- | --- |
| `package.json` | the manifest: one `Workbench` module that requires the host's `WorkbenchHost`, provides `WorkbenchMain` and contributes one tab, an iframe of `ui/index.html` |
| `index.ts` | the handler, compiled by the host: the Benchmark routes under the workbench's API mount, kept in its agent-level data folder (`<agentDir>/app/data/benchmark/`), the prompt each task sends, the tasks the page started (in the workbench's state), and the seeds written on the first load |
| `lib/` | the handler's modules: `format/` (a copy of `./format`, written by `scripts/copy-format.mjs`), `vendor/` (smol-toml and yaml as TypeScript source, with their licences) and a zip container over `node:zlib` |
| `ui/` | the page, built by Vite (React and `@prismshadow/penguin-ui` bundled, no Mermaid, text files only: fonts and pictures inline): it reads its Project, Agent and server from its own address, and calls the handler and the Web App's own routes as the person who opened it |
| `seeds/` | the seeded Benchmarks and `catalog.json`, which lists them for the harness's gallery and landing page |

An admin's page also reads each machine's copy of the same Agent's workbench through the host's machine proxy and merges them by id; a machine that has not upgraded is read at its older `/api/projects/:projectId/benchmarks` route (compatibility kept until 1.0).

## Development

Node 24 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # the format copy is current, tsc (package, handler, page), the handler under the host's options, the toolkits
pnpm test             # vitest: the format, the handler (over a fake host), the page (happy-dom), Skills, scripts
pnpm build            # tsup (./format) → vite (workbenches/benchmark/ui/) → lib/format → ifaces.json → toolkits
pnpm format:check
pnpm pack:check       # after build: the static probe, and npm pack twice with equal sha512
```

`scripts/check-workbench.mjs` (part of `typecheck`) compiles `workbenches/benchmark/index.ts` the way the host does — `strict`, `module: NodeNext`, `@types/node` only — against the types a 0.2.19 server writes into a workbench folder (`test/fixtures/harness-0.2.19/plugin.d.ts`), then loads what it emitted and lists the seeded Benchmarks. `ifaces.json` is written by `@prismshadow/penguin-core`'s `penguin-gen-ifaces` bin.

### Seeds

`node scripts/build-seeds.mjs` rebuilds `workbenches/benchmark/seeds/` and its `catalog.json` from the benchmark repository at `PINNED_COMMIT` (or `--repo <checkout>` for a local clone that has the commit). `--check` fails when either would change; CI runs it. Moving the pin is a change to the package's content.

## Release

Tag the reviewed commit with `v<version>` to match the version in `package.json`. `v0.1.0-rc.1` is a release candidate and `v0.1.0` a stable release. The workflow tests and builds the package, compares two independent packs, then downloads the attached tarball and checks its bytes before publishing the GitHub release. A release candidate is published as a prerelease. Its notes come from the matching CHANGELOG section.

When the repository variable `NPM_TRUSTED_PUBLISHING` is `true`, the workflow also publishes the release’s tarballs to npm through trusted publishing. Stable versions go to `latest` and prerelease versions to the `rc` tag. A version npm already has is skipped, and must have the same bytes. Publish a new package name once by hand from its release tarball, then set this workflow and the `npm` environment as its Trusted Publisher on npm. To publish the tarballs of an existing release without a new tag, run the workflow by hand with its tag: `gh workflow run release.yml --ref main -f tag=v0.1.0`. The optional `skip` input names packages to leave out.

Use the release asset `penguinharness-rsi-workbench-<version>.tgz`. Register its versioned GitHub download URL and SHA-512 integrity in the [plugin index](https://github.com/Prism-Shadow/penguin-harness-plugins) when pinning the built-in workbench in PenguinHarness.

## License

Apache-2.0
