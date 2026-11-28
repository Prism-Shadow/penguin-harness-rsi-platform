# Initialize the reflection buffer

The inner Optimizer follows this file to prepare the Target before H_0 is measured. Reflexion evolves the Target's **reflection buffer** — a Target-owned Skill directory holding the episodic memory the Target reads before each trial. The Optimizer's and Organizer's installations, the policy model and the Benchmark stay fixed. `STATE`, `SKILL_DIR`, `BUFFER` and `OUT` are the absolute paths in the loop request. Source mode is not part of this toolkit: Reflexion's evolving artifact is the buffer only, and `experiment.yaml` records `harness_mode: state`.

## The Target

1. **Existing learning.** If `STATE/skills/reflexion-memory` exists already, stop. It is either an experiment to resume, which needs the matching `OUT/experiment.yaml`, or a buffer that must not be lost: ask the user, and never overwrite a buffer a previous run reflected into.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For an existing agent, make sure the snapshot of its current version exists (the snapshot rule in SKILL.md), then initialize at one more than the highest version in its current State, snapshots and scoreboard, as that rule requires.
3. **Freeze the run.** Set `memory.enabled: false` in `STATE/system_config.yaml` (replace the field, never add a duplicate key): the paper's trials answer every problem independently, and harness memory would carry one trial into the next outside the buffer. Make sure `STATE/memory/user/MEMORY.md` exists (the harness creates it at a Session's start otherwise, which would change the State between hashes).

## The slot

`OUT/scope.yaml` declares the files Reflexion owns:

```yaml
slot: STATE/skills/reflexion-memory
files:
  - { path: SKILL.md, pinned: { name: reflexion-memory, version_dated: true } }
  - { path: reflections.md, editable: append_and_prune }
reader: AGENTS.md
reader_line: fixed, outside any marker comments
```

Write `STATE/skills/reflexion-memory/SKILL.md` with today's dated version (`YYYY.MM.DD.1`):

```markdown
---
name: reflexion-memory
description: The written reflection buffer this agent applies to every task. Read reflections.md in full before acting on a task.
version: <YYYY.MM.DD.1>
---

Read `reflections.md` in this directory in full before any substantive action on a task, and apply that guidance to the task within the task's own access and output requirements. The buffer lives only in that file.
```

Create `STATE/skills/reflexion-memory/reflections.md` beside it with exactly this seed content:

```markdown
# Reflexion buffer

No trials have been reflected on yet.
```

Append this line to `STATE/AGENTS.md` (after a blank line when the file is not empty), exactly:

```text
Before any substantive action on any task, read `skills/reflexion-memory/SKILL.md` and `skills/reflexion-memory/reflections.md` in your Agent State in full, and follow that guidance.
```

The Skill body and that line stay identical for H_0, every trial and any later test; during the loop only `reflections.md` and the slot's `version` change. Reflector prompts, score matrices and answers never enter the Target outside the buffer.

## Verify and hand off

Parse `STATE/system_config.yaml` (expected `version`, no duplicate key) and the frontmatter of the slot's `SKILL.md` (`name: reflexion-memory`, matching its directory, dated `version`); confirm the reader line appears exactly once in `STATE/AGENTS.md` and the seed buffer matches the seed text above. Record in `OUT/experiment.yaml`: the H_0 version, the SHA-256 of `reflections.md`, of the slot's `SKILL.md` and of the reader line, that the seed buffer was used, and whether the Target was created or extended. Snapshot H_0 and retain the snapshot and the State digest. No other Agent changes. H_0 is the initialized State with an empty buffer; that is what trial 1 measures.

## Versions, snapshots and restore

A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

For each trial, also retain `OUT/trials/t<N>.json`: the measured version, its snapshot path, its buffer section range and the buffer digest at measurement.

## Restore a recorded trial

The Optimizer uses this when finishing the loop; the Organizer uses it to restore H_0 and the best trial for testing. Restore the State at its measured version, without renumbering:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is that trial's and that `reflections.md` matches the buffer digest recorded for it.
