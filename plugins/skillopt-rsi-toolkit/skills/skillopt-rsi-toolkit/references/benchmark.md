# Use an installed Benchmark

Read the selected package's `benchmark_config.toml` and Case `statement/README.md`. Follow their linked benchmark README and task manifest. These documents are the authority for task paths, environment access, feedback, scoring and exports; this toolkit supplies the learning algorithm.

## Discover the runtime

Resolve:

- The matching Train/Test packages, any separate validation set and their native tasks.
- The continuous training entry point and the questions it contains.
- Input locations, business tools, training feedback and score aggregation.
- Answer and Skill exports, native result files and trace locations.
- Runtime installation, adapter options, network access and limits.

A package may contain one Train Case that includes several questions, and several independent Test Cases. Read that mapping explicitly. Do not derive it from an old task-group name or assume every directory is an independent training trial.

For repository-backed tasks, record the task repository and the full 40-character lowercase data commit specified by the Task link and checkout instruction. Follow the Case's linked run instructions. The Case’s shared adapter link takes precedence over any adapter version in the task repository’s README. Resolve `main` once if the link uses it, and record the adapter commit separately. Reuse those revisions throughout training and testing. A requested task version selects the matching package.

When there is no separate validation set, reuse all Train tasks for candidate selection by default, or a requested fixed subset. Every Train task remains in the learning roster. Record the selection task IDs and overlap; never use Test for this role.

## Launch and collect

Follow the documented command, adapter and experimental setup requested by the user. In a continuous training environment, the training Session and business container remain alive across tasks and candidate edits; the learner may make task-focused calls inside that environment and owns the learning iterations.

The runtime must support a continuing training environment and usable feedback. If it does not, report that incompatibility rather than silently changing training into independent reset trials.

Use native output paths returned by the runner. Collect the exported Skill folders and learning records before constructing frozen test States. A combined Train/Test job does not itself transfer learned Skills; the controller performs that handoff and schedules the requested evaluation runs. Each evaluation attempt starts from the same frozen archive in a fresh environment and conversation.

Apply the benchmark's time and network settings. Count sidecars as well as business containers against the shared capacity limit. Follow its retry rules and retain failed attempts. Completed low-scoring answers are measurements; do not retry them as infrastructure errors.

The final training verifier grades the exported answers. It is distinct from the current/candidate measurements used by SkillOpt. Keep both and use the learning records to establish which iterations ran.
