---
name: reflexion-rsi-toolkit
description: >-
  Organize a Reflexion (verbal reinforcement learning, Shinn et al. 2023) experiment with a
  dedicated optimization Session: after every measured trial a Reflector distills the score
  matrix and the failed cases' public statements into one short written reflection, the Target
  carries the reflection buffer into its next trial, and the best-scoring trial is kept.
version: 2026.11.24.1
---

# Reflexion

[Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366), Shinn et al., 2023 ([arXiv:2303.11366v3](https://arxiv.org/abs/2303.11366v3)). Reference implementation: [noahshinn/reflexion](https://github.com/noahshinn/reflexion). Reflexion improves an actor without touching weights: the actor attempts the task, an evaluator scores the attempt, a self-reflection model turns the result into short written advice, and the advice enters an episodic memory buffer the actor reads before its next attempt. Model weights, tools and the rest of the Target's harness stay fixed; only the reflection buffer grows, and the best-scoring trial is kept.

You are the outer experiment **Organizer**. Prepare the environment, launch a dedicated inner Penguin **Optimizer**, collect its best trial, and arrange testing and reporting. The Optimizer owns the trial loop: measurements, reflections, buffer updates and trial selection. The **Target** runs the tasks. Keep these three Agents separate.

## Before you start

The Organizer needs `run_subagent` only for the frozen H_0/best report measurements. The Optimizer needs it for its measurement workers and its Reflector; it runs as an independent CLI Session precisely so it can spawn them.

If the message only names this Skill, ask for the Target and the Benchmark, and offer the demo task in `references/demo-task.md`. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. It must differ from both the Organizer and the Optimizer.
- `benchmark_id`: a published Benchmark of this Project whose `benchmark_config.toml` status is not a literal `draft` or `failed`. Its cases are the trials' task set.
- `test_benchmark_id` (optional): a held-out Benchmark. H_0 and the best trial are measured on it after training; nothing of it reaches the Reflector or the buffer.
- `case_ids`: every case unless the user names a subset. `k` controls trials per task inside one trial measurement; a supplied `runs` is an alias for `k`. `test_repetitions` controls the H_0/best report measurements, not the loop.
- The Target's runtime, fixed once per experiment: the provider/model pair requested by the user, else this Session's pair, with the Target's configured thinking level (`medium` when absent). The Optimizer's runtime is this Session's runtime unless requested otherwise; its Reflector inherits it. Pass both runtimes explicitly.
- The method's parameters, with the values of the source:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| `N`: trials | the paper varies N by environment; its HumanEval results report pass@1 80.1 → 91.0 with GPT-4 | 2 |
| `K`: buffer size | the paper keeps recent reflections in an episodic memory buffer | 3 |
| reflection length | short and structured | at most 6 bullets |
| early stop | none in the source | stop at a complete 100.00 matrix |
| Reflector sampling | the providers' defaults (Penguin sets no temperature) | the same; record it |

The smoke profile applies unless the user sets parameters. A target score or a wall-clock limit is not a Reflexion parameter: report against one if given, but never let it change the loop.

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
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/reflexion-rsi-toolkit/<experiment_id>/
SKILL_DIR    = OUT/method                  # contains references/
BUFFER       = STATE/skills/reflexion-memory/reflections.md
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Write `OUT/experiment.yaml` before the first measurement; the Optimizer fills in trial and selection fields during the loop:

```yaml
method: Reflexion
paper: Reflexion: Language Agents with Verbal Reinforcement Learning (Shinn et al., 2023)
arxiv_url: https://arxiv.org/abs/2303.11366
github_url: https://github.com/noahshinn/reflexion
source_revision: <observed commit of the reference implementation, recorded at initialization>
skill: { name: reflexion-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
optimizer_agent_id: <id>
optimizer_session_id: <id, recorded after launch>
benchmark_id: <id>
test_benchmark_id: <id or null>
case_ids: [<case ids>]
runs: <k>
runtime: { target: { provider, model_id, thinking_level }, reflector: { provider, model_id } }
parameters: { trials: <N>, buffer_size: <K>, max_bullets: 6 }
state: { h0_version, buffer_sha256, skill_sha256, reader_sha256 }
artifact: skills/reflexion-memory/reflections.md in the Target's Agent State
trials: [<trial records: version, score, reflection ids>]
best: { version, score }
source: the evaluation set's cases
feedback: the Reflector sees score matrices, public statements and prior reflections; it never sees a Rubric, a Trace or an unauthorized answer
updater: the Reflector's written reflection; this Session alone applies it and publishes a version
frequency: one reflection per trial, appended to the buffer
topology: episodic buffer (the last K reflections)
selection: highest evaluation-set score over trials; an exact tie keeps the earliest
mode: offline, evaluation set only
scope: the reflection buffer this run declares
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every Reflector prompt and raw reply, every reflection as applied or the reason it was dropped, every measurement with its cells and Session ids, and every failure.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

## Prepare and launch the loop

1. Resolve the requested Target, Benchmarks, runtimes and budget. Use a separate output directory, Optimizer Agent, continuing Session and Target per independent experiment.
2. Create the Optimizer Agent with Penguin's existing CLI. Copy this toolkit's `references/` directory to `SKILL_DIR/references/`. Save a loop request in OUT containing the evaluation brief, the Target identity and runtime, the buffer slot, the parameters, the absolute paths and resource limits. Give the Optimizer its absolute path.
3. Launch one independent Optimizer Session with `penguin run --background --json`, explicitly setting its Project, Agent, workspace, provider, model, thinking level and authorized `--approve` mode. Record that mode; if it requires approvals, the Organizer must monitor and handle those requests for the independent Session. Its short message tells it to read `SKILL_DIR/references/training.md` and the loop request, run the trials, and return the buffer and the best-trial version record. Do not send it back to this Organizer entry point. An ordinary `run_subagent` worker cannot host this loop because it cannot spawn the loop's own workers; the separate CLI Session can.
4. Record the returned Session ID and follow its progress with the supported Session tools. The Optimizer runs the entire loop: measurements, reflections, buffer updates and trial selection. The Organizer monitors resource use and handles environment failures; it does not write reflections, select trials or substitute its own best version. Resume the same Optimizer Session and its saved buffer after an interruption.

[Initialization](references/initialization.md) is for the inner Optimizer to prepare H_0 and the buffer slot. [Training](references/training.md) is its complete loop. Follow the Benchmark's execution contract for measurements; the Optimizer's buffer survives across trials while task executions use the environments that contract requires.

**Budget.** For N trials over M evaluation cases, the loop uses up to `N × M × k` Target trials, plus one Reflector session per trial after the first, plus the H_0/best report measurements the contract names. State the planned budget before launching. The smoke profile is `N = 2`: `2 × M × k` Target trials and 1 Reflector call.

## Collect, test and report

Collect the Optimizer's completion status, the buffer and the best-trial version record. Its best trial is the highest evaluation-set score in the loop; verify the returned artifacts match the saved versions and snapshots, and do not rank the trials again. A stopped loop is reported as incomplete.

After the loop completes, use [evaluation](references/evaluation.md) to measure H_0 and the best trial with their frozen State, following the Benchmark's contract in fresh task conversations and environments. Test Targets receive the solving buffer, not the Reflector's history or loop instructions. The Optimizer remains finished; test feedback never reopens the loop or changes the selected trial.

If a held-out `test_benchmark_id` was supplied, measure H_0 and the best trial on it with `runs` trials per task. Otherwise report evaluation-set measurements only. Restore each version with the procedure in `references/initialization.md` and finish with the best trial restored. Report evaluation-set and held-out measurements separately.

Report:

- the per-trial scores in order, with each trial's State version and buffer digest;
- the reflections: how many were written and applied, how many dropped, and the drops' reasons;
- the best trial: its score, its delta against H_0, and its snapshot version restored last;
- the buffer's final entry count against `K`;
- the sources: the paper, the reference implementation and the revision recorded at initialization;
- the cost of every role as far as it is recorded: Target trials from the evaluation records, and Organizer, Optimizer and Reflector Sessions from their own usage without double counting children; say which parts are unknown;
- the adaptations: the metric-feedback mode (the Reflector reads the score matrix and public statements, not the actor's trajectory — the family's evaluation protocol exports matrices, not traces), the buffer as a Target-owned Skill read by a fixed reader line, parameters and budget used, and whether a held-out split was evaluated. Do not claim the paper's published HumanEval, AlfWorld or HotpotQA numbers;
- where to look: complete case-level measurements appear in the Evaluation Center under `<agent_id> · <model_id> · <thinking_level>`; OUT retains the buffer history, all measurements, reflections and failures.
