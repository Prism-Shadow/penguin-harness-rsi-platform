# Initialize the harness package and the archive

The inner Optimizer follows this file to prepare the Target before H_0 is measured. DGM evolves a target-owned **harness package** — the Skill directory whose files define how the Target approaches its task class — together with the reader line that invokes it. The Optimizer's and Organizer's installations, the policy model and the Benchmark stay fixed. `STATE`, `SKILL_DIR` and `OUT` are the absolute paths in the search request. Source mode (evolving a target source checkout) is a possible extension of this toolkit and is not implemented in this version; declare `harness_mode: state` in `experiment.yaml`.

## The Target

1. **Existing learning.** If `STATE/skills/dgm-agent` exists already, stop. It is either an experiment to resume, which needs the matching `OUT/experiment.yaml`, or learning that must not be lost: ask the user, and never overwrite a package a previous run evolved.
2. **Version.** A Target created for this experiment is initialized in place, at `version` 1. For an existing agent, make sure the snapshot of its current version exists (the snapshot rule in SKILL.md), then initialize at one more than the highest version in its current State, snapshots and scoreboard, as that rule requires.
3. **Freeze the run.** Set `memory.enabled: false` in `STATE/system_config.yaml` (replace the field, never add a duplicate key): the paper's trials answer every problem independently, and harness memory would carry one trial into the next outside the archive. Make sure `STATE/memory/user/MEMORY.md` exists (the harness creates it at a Session's start otherwise, which would change the State between hashes). Snapshot the current version.

## The editable scope

Write `OUT/scope.yaml` declaring the files DGM may evolve, and nothing else:

```yaml
slot: STATE/skills/dgm-agent
files:
  - { path: SKILL.md, editable: body_and_description, pinned: { name: dgm-agent, version_moved_by: controller } }
  - { path: strategy.md, editable: full }
  - { path: examples.md, editable: full }
  - { path: checklist.md, editable: full }
reader: AGENTS.md
reader_region: between the DGM marker comments
```

The exact file set is the one the demo task or the user's request names; every file in the set must exist in H_0 so a diff against H_0 is meaningful. Nothing outside the slot is editable: `system_config.yaml`, `memory/`, other Skills, tools and hooks are outside DGM's scope, and the paper's risk of a candidate that changes its own grading or launch plumbing maps here to those files being frozen.

Create the slot with today's dated version (`YYYY.MM.DD.1`):

`STATE/skills/dgm-agent/SKILL.md`:

```markdown
---
name: dgm-agent
description: Harness of this Agent - read it in full before your first substantive action on a task.
version: <YYYY.MM.DD.1>
---

# Harness

This Skill is the harness this Agent runs by: the procedure it follows, how it approaches the
task class, what it verifies before answering, and which supporting files it consults. Read it
in full before your first substantive action on a task and follow it.

Read `strategy.md`, `examples.md` and `checklist.md` in this directory as the procedure directs.
These files are instructions for this Skill, not automatic engine configuration.

## Procedure

Understand the task, plan, act, check the result against the task's own requirements, and finish.
Keep the output the task asks for.
```

and the starting package files named above, each with minimal seed content (`strategy.md`: one short paragraph saying to solve the task directly from its statement; `examples.md`: `entries: []`; `checklist.md`: `checks: []`). Write `STATE/skills/dgm-agent/config.yaml` only if the demo task or the user declares procedure settings.

Append this line to `STATE/AGENTS.md` (after a blank line when the file is not empty), exactly:

```text
Before your first substantive action on any task, read `skills/dgm-agent/SKILL.md` and the files it names in your Agent State in full, and follow that Skill.
```

Wrap the line with the two marker comments the search uses for delimited edits:

```text
<!-- dgm:reader begin -->
Before your first substantive action on any task, read `skills/dgm-agent/SKILL.md` and the files it names in your Agent State in full, and follow that Skill.
<!-- dgm:reader end -->
```

## Verify and hand off

Parse `STATE/system_config.yaml` (expected `version`, no duplicate key) and the frontmatter of `SLOT/SKILL.md` (`name: dgm-agent`, matching its directory, dated `version`). Confirm every scope file exists and the reader block appears exactly once in `STATE/AGENTS.md`. Record in `OUT/experiment.yaml`: the H_0 version, the SHA-256 of every scope file and of `AGENTS.md`, which seed was used, and whether the Target was created or extended. Snapshot H_0 and retain the snapshot and the State digest. No other Agent changes. H_0 is the initialized State with nothing learned yet; that is what the baseline measures.

## Versions, snapshots and restore

A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

For each version, retain `OUT/versions/v<N>.json`: the snapshot path, the parent version, the generation, the selection mode, the Modifier's edit summary and the archive entry id. Measured versions are immutable.

## Restore a recorded version

The Optimizer uses this when finishing the search; the Organizer uses it to restore H_0 and the best variant for testing. Restore the State at its measured version, without renumbering:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is that variant's and that every file under `skills/dgm-agent/` matches the SHA-256 recorded for it in `OUT/versions/v<W>.json` and `OUT/archive.yaml`.
