---
name: dgm-rsi-toolkit
description: >-
  Organize a Darwin Gödel Machine (Sakana AI, 2025) experiment with a dedicated optimization
  Session: an archive holds the Target's harness variants, parents are drawn from it by score
  and case-pass diversity, a fresh Modifier session edits the parent's files into one candidate,
  every candidate is measured on the frozen Benchmark, and admitted variants join the archive
  for open-ended, multi-branch search.
version: 2026.11.24.1
---

# DGM

[Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents](https://arxiv.org/abs/2505.22954), Sakana AI & UBC (Zhang, Hu, Lu, Lange, Clune), 2025 ([arXiv:2505.22954v3](https://arxiv.org/abs/2505.22954v3), §3 method, §C hyperparameters and prompts, Algorithm 1–2). Reference implementation: [jennyzzt/dgm](https://github.com/jennyzzt/dgm), observed revision recorded in `experiment.yaml` at initialization. Native reimplementation on PenguinHarness: the paper's coding-agent variants become Target-owned harness packages under the declared editable scope, the archive becomes the experiment directory plus the Target's snapshots, and the paper's SWE-bench loop becomes any frozen Benchmark of this Project.

You are the outer experiment **Organizer**. Prepare the environment, launch a dedicated inner Penguin **Optimizer**, collect its best harness, and arrange testing and reporting. The Optimizer owns the archive, parent selection, candidate proposals, review, measurements and admission. The **Target** runs the candidate harness. Keep these three Agents separate.

DGM evolves the **harness** of a frozen policy with no weight updates: every candidate is the parent's file package plus the edits one fresh Modifier session proposed for it, measured on the same frozen Benchmark. The archive keeps every valid child, so a branch that scores below its parent can still be explored later; parents are drawn from the archive by score and case-pass diversity, which is what makes the search open-ended and multi-branch. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

The Organizer needs `run_subagent` only for the frozen baseline/final measurements. The Optimizer needs it for its Modifiers and its measurement workers; it runs as an independent CLI Session precisely so it can spawn them.

If the message only names this Skill, ask for the Target and the Benchmark, and offer the demo task in `references/demo-task.md`. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. It must differ from both the Organizer and the Optimizer.
- `benchmark_id`: a published Benchmark of this Project whose `benchmark_config.toml` status is not a literal `draft` or `failed`. Its cases are DGM's evaluation set.
- `test_benchmark_id` (optional): a held-out Benchmark. H_0 and the best variant are measured on it after training; nothing of it reaches the Modifier or the archive notes. Without one, report evaluation-set results only.
- `case_ids`: every case of the Benchmark unless the user names a subset. `k` controls runs per task in candidate measurements; a supplied `runs` is an alias for `k`. `test_repetitions` controls the H_0/best report measurements, not the search.
- `harness_source` (optional): the target harness's source checkout and starting revision, for source mode. Otherwise the State-only adaptation applies (declared below).
- The Target's runtime, fixed once per experiment: the provider/model pair requested by the user, else this Session's pair, with the Target's configured thinking level (`medium` when absent). The Optimizer's runtime is this Session's runtime unless requested otherwise; its Modifiers inherit it. Pass both runtimes explicitly.
- The method's parameters, with the values of the source:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| `T`: generations | 80 in the paper's reported runs | 2 |
| archive | every valid child stays archived and parent-eligible (§3, Algorithm 1) | the same |
| parent selection | greedy, or weighted random by sigmoid-scaled score and child count (§C.2; the greedy-only ablation is §A.3) | alternate greedy (odd generations) and weighted random (even) |
| diversity signal | embedding similarity of agent code and performance | Jaccard distance of case-level pass sets (declared adaptation: no embeddings in this harness) |
| children per parent | 1 candidate per selected parent per iteration | 1 |
| evaluator | SWE-bench Verified / Polyglot via the paper's unit-test harness | this Project's frozen Benchmark through the shared evaluation protocol |
| early stop | none in the source | stop at a complete 100.00 matrix |
| Modifier sampling | the providers' defaults (Penguin sets no temperature) | the same; record it |

The smoke profile applies unless the user sets parameters. The source's budget (roughly two benchmarks over 80 open-ended generations, about two weeks of machine time in the paper's §E.1 estimate) is never a default: run it only when the user asks for it, after you state its arithmetic (see "Budget") and they confirm. A target score is not a DGM parameter: report against one if given, but never let it change the search.

## Paths and records

Resolve these paths once from the Organizer's Environment and pass their absolute values to the Optimizer and evaluation workers; a new Session must not derive a different OUT from its own scratchpad. `SKILL_DIR` is the copy of the method references prepared for this experiment:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = <the BENCHMARK_DIR the request names>
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SNAPSHOTS    = TARGET/snapshots
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/dgm-rsi-toolkit/<experiment_id>/
SKILL_DIR    = OUT/method                  # contains references/
SOURCE       = <isolated target source checkout, when harness_source is available>
ARCHIVE      = OUT/archive.yaml
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Write `OUT/experiment.yaml` before the first measurement; the Optimizer fills in the archive and calibration fields during the search:

```yaml
method: DGM
paper: Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents (Sakana AI, 2025)
arxiv_url: https://arxiv.org/abs/2505.22954
github_url: https://github.com/jennyzzt/dgm
reference_revision: <observed commit of the reference implementation, recorded at initialization>
skill: { name: dgm-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
optimizer_agent_id: <id>
optimizer_session_id: <id, recorded after launch>
benchmark_id: <id>
test_benchmark_id: <id or null>
case_ids: [<case ids>]
runs: <k>
runtime: { target: { provider, model_id, thinking_level }, modifier: { provider, model_id } }
parameters: { generations: <T>, parent_selection: alternating_greedy_weighted, diversity: case_pass_jaccard, children_per_parent: 1 }
editable_scope: { slot: STATE/skills/dgm-agent, reader: STATE/AGENTS.md }
state: { h0_version, h0_sha256, reader_sha256 }
artifact: skills/dgm-agent/ in the Target's Agent State
archive: OUT/archive.yaml
source: the evaluation set's cases
feedback: the Modifier sees the parent's package files, the archive record of its lineage and the public statements of cases the parent did not fully score; it never sees a Rubric, a Trace or an unauthorized answer
updater: Modifier proposals; this Session alone validates, applies and publishes a version
frequency: one candidate per generation, all against one archive snapshot
topology: archive over the edit history (variants and their measured credit)
selection: every valid child is archived and parent-eligible; the reported best is the highest evaluation-set score
mode: offline, evaluation set only
scope: the harness package this run declares
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every Modifier prompt and raw reply, every parsed edit list with the version it produced or the reason it was dropped, every measurement with its cells and Session ids, and every failure.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

For each version, also retain `OUT/versions/v<N>.json`: the snapshot path, the parent version, the generation, the selection mode, the Modifier's edit summary and the archive entry id. Measured versions are immutable; restoring one restores the exact files that were evaluated.

## Prepare and launch the search

1. Resolve the requested Target, Benchmark, runtimes and budget. Use a separate output directory, Optimizer Agent, continuing Session and Target per independent experiment.
2. Create the Optimizer Agent with Penguin's existing CLI. Copy this toolkit's `references/` directory to `SKILL_DIR/references/`. Save a search request in OUT containing the evaluation brief, the Target identity and runtime, the editable scope, the parameters, the absolute paths and the archive seed record. Give the Optimizer its absolute path.
3. Launch one independent Optimizer Session with `penguin run --background --json`, explicitly setting its Project, Agent, workspace, provider, model, thinking level and authorized `--approve` mode. Record that mode; if it requires approvals, the Organizer must monitor and handle those requests for the independent Session. Its short message tells it to read `SKILL_DIR/references/training.md` and the search request, run the archive search, and return the archive and the best-variant version record. Do not send it back to this Organizer entry point. An ordinary `run_subagent` worker cannot host this loop because it cannot spawn the search's own workers; the separate CLI Session can.
4. Record the returned Session ID and follow its progress with the supported Session tools. The Optimizer runs the entire search: archive updates, parent selection, Modifier dispatch, candidate application and measurement. The Organizer monitors resource use and handles environment failures; it does not propose edits, select parents, admit variants or substitute its own best version. Resume the same Optimizer Session and its saved archive after an interruption.

[Initialization](references/initialization.md) is for the inner Optimizer to prepare H_0 and the editable scope. [Training](references/training.md) is its complete search loop. Follow the Benchmark's execution contract for measurements; the Optimizer's archive survives across generations while task executions use the environments that contract requires.

**Budget.** For N evaluation cases, the search uses up to `T × N × k` Target trials, plus liveness and calibration trials the Benchmark's contract names, plus one Modifier session per generation. State the planned budget before launching. The smoke profile is `T = 2`: `(1 + 2) × N × k` Target trials and 2 Modifier calls.

## Collect, test and report

Collect the Optimizer's completion status, the archive and the best-variant version record. Its best variant is the highest evaluation-set score in the archive; verify the returned artifacts match the saved archive and snapshots, and do not rank historical variants again. A stopped search is reported as incomplete.

After the search completes, use [evaluation](references/evaluation.md) to measure H_0 and the best variant with their frozen State, following the Benchmark's contract in fresh task conversations and environments. Test Targets receive the harness package, not the Modifier's history or archive notes. The Optimizer remains finished; test feedback never reopens the search or changes the reported best.

If a held-out `test_benchmark_id` was supplied, measure H_0 and the best variant on it with `runs` trials per task. Otherwise report evaluation-set measurements only. Restore H_0, measure, restore the best variant, measure, and finish with the best variant restored (the restore procedure is in `references/initialization.md`).

Report:

- the archive: every variant with its version, parent, generation, selection mode and score, and the variants that failed measurement with their reasons;
- the best variant: its score, its delta against H_0, and its package diff against H_0's files;
- the parent-selection trajectory: each generation's mode, the parent drawn and the weights behind the draw;
- the Modifiers: how many ran, their tokens as far as recorded, and every dropped edit with the reason;
- the calibration and noise observations if the Benchmark contract names any;
- the sources: the paper, the reference implementation and the revision recorded at initialization;
- the cost of every role as far as it is recorded: Target trials from the evaluation records, and Organizer, Optimizer and Modifier Sessions from their own usage without double counting children; say which parts are unknown;
- the adaptations: State-only editable scope, target harness and model, Benchmark metric and aggregation, the Jaccard diversity signal in place of embeddings, parameters and budget used, and whether a held-out split was evaluated. Do not claim the paper's published SWE-bench or Polyglot numbers;
- where to look: complete case-level measurements appear in the Evaluation Center under `<agent_id> · <model_id> · <thinking_level>`; OUT retains the archive, all measurements, proposals and failures.
