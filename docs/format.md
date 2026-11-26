# The Benchmark format

A Benchmark is a folder named by its id (letters, digits, `_` and `-`) in a Project's Benchmark folder, which the host names for this app (`<data root>/projects/<project>/agents/system_agent/app/data/benchmark/`). Its **package** is the folder minus what this copy keeps for itself:

```text
<benchmark id>/
├── benchmark_config.toml     # the manifest: what the Benchmark is (package)
├── CASE-001-<slug>/          # one folder per case (package)
│   ├── statement/README.md   #   what the Test Agent sees, plus any files it names
│   ├── rubric/README.md      #   how a run is scored, 100 points; never shown to the Test Agent
│   └── task_config.toml      #   optional, for a case run elsewhere (Harbor)
├── scoreboard.yaml           # this copy's evaluations (not package)
└── .jobs/, .harbor/, …       # this copy's run state (not package)
```

`@penguinharness/rsi-workbench/format` reads and writes both files: `parseBenchmarkManifest`, `checkBenchmarkManifest`, `readBenchmarkManifest`, `writeBenchmarkManifest`, `parseScoreboard`, `nextDateVersion`.

## `benchmark_config.toml`

| Key | Type | Read | Written |
| --- | --- | --- | --- |
| `id` | id | must equal the folder name (`benchmark_id_mismatch`); absent: the folder's | always |
| `title` | text | absent or empty: the id | 1–200 characters, not blank |
| `title_zh` | text | optional | 1–200 characters |
| `description` | text | optional | ≤ 2000 characters |
| `description_zh` | text | optional, shown to a reader of the Chinese interface | ≤ 2000 characters |
| `version` | `x.y.z` or `YYYY.MM.DD.N` | optional: unversioned | as read |
| `last_update` | ISO 8601 | optional | as read |
| `status` | `draft` / `published` / `failed` | only a literal `draft` or `failed` is one; anything else is `published` | one of the three |
| `runs` | integer | runs per case; anything but a positive integer is left out (one run) | 1–1000 |
| `data_url` | http(s) link | the upstream data repository; optional | as read |
| `references` | list of http(s) links | optional | as read |
| `[author]` | `name`, `email?`, `homepage?` | optional | as read |
| `[origin]` | `kind`, `url?`, `ref?`, `path?`, `imported_at?` | where this copy came from; optional | as read |

`[origin].kind` is `builtin` (seeded with the Project), `manual` (the create form), `agent` (benchmark-design wrote it), `git` (an Agent imported a repository folder; `url`, `ref` — a 40-character commit — and `path`) or `zip` (an uploaded package). A manifest that is not TOML, or whose newer keys are out of shape, cannot be read (`benchmark_manifest_invalid`): the Benchmark lists as `failed` with the reason. Keys the format does not know are ignored, and reading never rewrites a file.

## `scoreboard.yaml`

```yaml
evaluations:
  - time: 2026-07-14T09:30:00Z     # ISO 8601
    agent_id: default_agent        # the Agent under test (optional on read)
    version: 1                     # its Agent State version: a build number or a label
    provider: deepseek             # the model the Test Agent ran on, as a pair
    model_id: deepseek-v4-pro
    thinking_level: medium         # from the Test Agent's configuration
    summary_title: …               # one-line conclusion (optional on read)
    summary: …                     # how the score came about (optional on read)
    score: 60                      # average of the case scores, 0..100
    cost: 0.013                    # average of the known case costs, or null
    duration_ms: 57500             # average of the case durations, an integer
    cases:
      - case: CASE-001-file-summary
        score: 60                  # average of the run scores
        cost: 0.013                # average of the known run costs, or null
        duration_ms: 45000
        runs:
          - { score: 50, cost: 0.012, duration_ms: 42000, session_id: session-… }
```

The file's order is the evaluation sequence. The averages are written by the evaluating Agent and read as written: nothing recomputes, migrates or backfills them. An evaluation with a field out of shape (or a case or run out of shape) is dropped on its own; a file that is not YAML reads as no evaluations. Score averages keep two decimals, cost averages six, durations are integers. A Harbor trial records the trial's name as `session_id`.

## The zip package

Export (`GET …/benchmarks/<id>/archive`, a published Benchmark only) and import (`POST …/benchmarks/archive`) carry the package under one top-level `<id>/` folder (or at the zip's root, where the manifest must name its id). Limits: 14 MB zipped, 5 MB a file, 20 MB inflated. A zip carrying `scoreboard.yaml`, a dot-entry or anything else at its top level, a link, a manifest past the written limits, a package that is not `published`, or a case without both READMEs is refused. The copy is written with origin `zip` (or `git`) and an empty scoreboard.
