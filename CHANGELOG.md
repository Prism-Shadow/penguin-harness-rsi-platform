# Changelog

Each release's section is the GitHub release's notes. Versions follow semver; the harness pins one exact version.

## [0.1.0-rc.1] - 2026-11-22

The first version: the harness's Evaluation Center as the external built-in plugin 「自进化工作台」 / Self-Evolution Workbench ([PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)).

- The data routes under `/api/projects/:projectId/benchmarks` (list, create, delete, zip import and export, cases and their files), moved from the harness with their requests, answers and error codes; the Benchmarks live in the folder the host names for the app (`AppData`).
- An admin's list and case list read each machine's copies apart (`?machine=<id>`) and merge them on the page as each answers, so this server's rows never wait on a machine; a Benchmark's cases are asked only of the machines that hold it.
- `GET …/benchmarks/context` and `POST` / `GET …/benchmarks/tasks`: Create with AI, Import with an Agent, Evaluate, Optimize and Ask AI start an Agent task as the person's own conversation, with the approval mode the form chose (allow-all by default); a missing Skill refuses the start and names the plugin; the tasks are recorded in the app's state folder and listed with their state.
- The page, rewritten as an iframe app (React and `@prismshadow/penguin-ui` bundled), opened in the App Center's window; it keeps its place in the window's address and opens conversations in the host.
- The `benchmark-design` and `agent-evaluation` Skills (from `@penguinharness/agent-evaluation`), version `2026.11.20.2`.
- Seeds: the Example Benchmark and the 18 built-in Benchmarks of penguin-harness-benchmark at `b44bb87`; the start page's Benchmarks count (7).
- `@penguinharness/rsi-workbench/format`: the manifest and scoreboard format, and `docs/format.md`.
