# The archive search

The inner Optimizer's complete loop. It owns the archive, parent selection, Modifier dispatch, candidate application, measurement and admission. The Organizer monitors resources and handles environment failures; it never proposes edits, draws parents or admits variants. `STATE`, `SKILL_DIR`, `OUT`, `ARCHIVE` and the parameters in `OUT/experiment.yaml` are the absolute paths and values the Organizer supplied.

## The archive

`OUT/archive.yaml` is append-only. Its seed entry is written at initialization and records H_0:

```yaml
variants:
  - variant: v1
    parent: null
    generation: 0
    selection: seed
    change_summary: initial harness package
    admitted: true
    score: <filled in when H_0's matrix completes>
    case_scores: { <case_id>: <score> }
    state_sha256: <digest at measurement>
```

Every later entry appends below it. `case_scores` is the pass/fail-or-score vector the diversity draw reads; `state_sha256` is the digest taken when that version was measured. Failures join the archive too: `admitted: false` with the reason, and the entry still carries whatever measurement completed. A failed proposal with no measurement joins as `admitted: false`, `score: null`, `reason: no_valid_edits` or `reason: modifier_failed`. The archive is the experiment's memory: a variant that scored badly stays selectable, because the paper's search moves through branches a strict best-first rule would never visit.

## Selection weights

Each generation t draws one parent from the archive. Odd generations select greedily: the highest evaluation-set score among archived, measured variants, ties keeping the earliest. Even generations select by weighted random, with Python's `random.Random(<generation>)` seeding the draw: each variant's weight is `w = sigmoid_scale(score) / (1 + children(v))`, where `sigmoid_scale(x) = 1 / (1 + exp(-(alpha0 + alpha1 * x)))` with the paper's `alpha0 = 0.5`, `alpha1 = 10.0` (score on 0..1), and `children(v)` is the number of direct children `v` already has. This is the paper's `score_child_prop` weighting; its embedding diversity term is replaced by the case-pass Jaccard distance below, which is a declared adaptation recorded in `experiment.yaml` and in the report.

The diversity term is applied when two candidates are close in weight: among variants whose weights are within 1% of the draw's maximum, prefer the one whose case-pass set has the greatest average Jaccard distance from the current parent's. Record the drawn parent, its weight and the mode in the archive entry of the child.

## The loop

For generation g = 1..T:

1. **Draw the parent.** Select `v_parent` per the selection weights, and record the mode and the weights of the drawn variant in the archive.
2. **Dispatch the Modifier.** Start a new `run_subagent` session with `agent_id` omitted, `provider`, `model_id` and `thinking_level` omitted (so it runs on this Session's model, the frozen one), and `yield_time_ms: 590000`. Its prompt is the Modifier block in `references/proposer.md`, followed by exactly: the parent's package files in full, the parent's archive record, the parent lineage's measured scores, and the public `statement/README.md` of every case the parent's matrix did not fully score. The Modifier never sees a Rubric, a Trace, an unauthorized answer or the archive of other lineages' files: a proposal that encodes one case's literal answer is the objective hacking the paper documents (§5, Appendix H) and is rejected in review. Save the prompt and the raw reply in OUT. There is one Modifier call per generation, and no Modifier sees another's text.
3. **Parse and check the edits.** The reply must contain exactly one JSON array; each edit carries `action: replace | create | delete`, `path: package/<relative path>` or `path: reader`, and, for `replace` and `create`, `content:` with the full new text. Apply every edit that passes its check: a `package/` path that resolves inside `STATE/skills/dgm-agent/` without traversal or symlink escape; a `reader` edit whose content replaces exactly the text between the marker comments, markers kept; a `replace` of a file that exists, a `create` of one that does not, a `delete` of one that is not the slot's `SKILL.md`. Drop an edit that fails its check and record the drop verbatim; if no edit survives, the child is a failed proposal, not a zero score. Never rewrite an edit to rescue it. The slot's `SKILL.md` body and description may be replaced, but its frontmatter stays: `name: dgm-agent`, and a `version` you move on (the next `N` of the day, else today's `.1`). An edit list that leaves the package empty but for `SKILL.md` is valid: the matrix will say what it is worth.
4. **Publish and measure the child.** Write the surviving edits, give the State a new `version` (SKILL.md, "Paths and records"), snapshot it, and measure it through `references/evaluation.md` on the full case set. The complete valid matrix joins `OUT/archive.yaml` as the child's entry; a failed or incomplete matrix joins with `score: null` and the reason. A generation whose child is a failed proposal still spends its budget, and nothing is refilled.
5. **Admit and archive.** The child is admitted when its matrix is complete and its score is strictly greater than the parent's recorded score, on the same cases, runtime and runs. A tie or a loss is recorded, not admitted: only admitted variants are candidates for parent selection. Declared adaptation: the paper adds every valid child to the archive and keeps every one selectable as a parent (§3, Algorithm 1), so a losing branch can still be explored later; here a branch continues only through strict improvements.

If a matrix cannot be completed under `references/evaluation.md`, that child has no score: record it, and report over the complete measurements.

### Modifier

You are the self-modifying agent of the Darwin Gödel Machine. You receive the complete code of a coding agent — its package files — and the archive's record of how it and its lineage scored. Propose one concrete modification, the way a developer improves a colleague's code: rewrite, add or delete package files, or re-tune how the reader block directs the agent to its package. Aim at the class of task the cases sample, not at any one case: a change that only helps by encoding a specific case's answer is the objective hacking the paper documents (§5, Appendix H) and is rejected in review.

## After the last generation

The search's deliverable is the archive's highest evaluation-set score; ties keep the earliest. Restore that variant's snapshot exactly (`references/initialization.md`, "Restore a recorded version") and verify its package digests. Write `OUT/best.json` with the version, score and archive entry, and report the archive as SKILL.md directs.

## Stops

Never edit the Benchmark to make a score possible; a Benchmark that fails `references/evaluation.md`'s published checks stops the run. Never record a score that no complete matrix produced, and never skip a measurement: a failed generation still spends its budget. Never instruct a Modifier to consult a Rubric or a worker's Trace, and never accept a proposal that quotes either: a package contaminated by a Rubric or an answer discards the experiment's later generations as contaminated. Numbers come only from `references/evaluation.md`.
