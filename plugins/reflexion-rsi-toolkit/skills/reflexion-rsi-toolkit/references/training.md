# The trial loop

The inner Optimizer's complete loop. It owns the trials, the reflections, the buffer and the trial selection. The Organizer monitors resources and handles environment failures; it never writes reflections, draws conclusions or substitutes its own best trial. `STATE`, `SKILL_DIR`, `OUT`, `BUFFER` and the parameters in `OUT/experiment.yaml` are the absolute paths and values the Organizer supplied.

## The buffer

`BUFFER` (`STATE/skills/reflexion-memory/reflections.md`) is the Target's episodic memory, seeded empty at initialization. Its shape:

```markdown
# Reflexion buffer

## Trial <t> (<UTC date>)
- <bullet>
- <bullet>
```

The buffer holds the last `K` trial sections; appending a section that exceeds `K` drops the oldest. The Target reads the buffer in full before any substantive action, via the reader line the initialization wrote into `STATE/AGENTS.md`. Reflections are the only thing that changes between trials: the harness slot, the reader line and the Target's other files stay as H_0 left them.

## The loop

For trial t = 1..N:

1. **Measure.** Measure the current State through `references/evaluation.md` on the full case set, exactly as SKILL.md's Measure section directs: snapshot before the matrix, State digest after, one complete matrix or a recorded failure. Append the evaluation to `SCOREBOARD` with a `summary_title` such as `Reflexion trial <t> · <score>` and, from trial 2 on, the buffer's entry count and digest in its `summary`.
2. **Reflect.** After trial t (1 ≤ t < N), unless the trial scored a complete 100.00 matrix (early stop): start a new `run_subagent` session — the Reflector — with `agent_id`, `provider`, `model_id` and `thinking_level` omitted (so it runs on this Session's model, the frozen one) and `yield_time_ms: 590000`. Its prompt carries exactly four things: the rules block in `references/reflector.md`, the trial's score matrix as recorded, the public `statement/README.md` of every case the matrix did not fully score, and the buffer's current text. Nothing else: no Rubric, no Trace, no worker output beyond the protocol YAML, no advice of your own. Save the prompt and the raw reply in OUT.
3. **Apply the reflection.** Parse the reply: it must contain exactly one `<REFLECTION>` block; if not, ask the same Reflector to resend from its existing result, never rerun the trial. Append the block's text as a `## Trial <t> (<UTC date>)` section of `BUFFER`, drop oldest sections beyond `K`, give the State a new `version`, and snapshot it before the next measurement. A Reflector that fails or returns nothing fails the reflection: record it; trial t+1 then runs on the unchanged buffer, and the budget is still spent.
4. **Select.** After trial N (or the early stop), the experiment's deliverable is the best-scoring trial's State — highest evaluation-set score, ties keep the earliest. Restore it exactly as `references/initialization.md` directs: at its measured version, without renumbering, verifying the package digests recorded for it. Write `OUT/best.json` with the trial number, score, version and buffer digest.

If a matrix cannot be completed under `references/evaluation.md`, that trial has no score: record it, and report over the complete trials.

## Stops

Never edit the Benchmark to make a score possible; a Benchmark that fails `references/evaluation.md`'s published checks stops the run. Never record a score that no complete matrix produced, and never skip a measurement: a failed trial still spends its budget. Never instruct a Reflector to consult a Rubric or a worker's Trace, and never accept a reflection that quotes either: a buffer contaminated by a Rubric or an answer discards the experiment's later trials as contaminated. Numbers come only from `references/evaluation.md`.
