# Demo task: precise summary

The demo that this Skill's quick start runs, and the smoke check for the whole loop: one archive,
two generations, twelve Target executions and two Modifier calls. The Benchmark is the same
precise-summary set the other RSI toolkits' demos ship: its six cases, statements and rubric are
defined byte-for-byte in the `opro-rsi-toolkit` Skill's demo (`plugins/opro-rsi-toolkit/skills/
opro-rsi-toolkit/references/demo-task.md`, its "Write the Benchmark" section; read it from that
installed plugin, never from the Target), and this Skill builds it from that definition unchanged.

## Setup

| Item | Value |
| --- | --- |
| Benchmark | `precise-summary`: the six cases of that definition, `runs = 1` |
| Target | `create: summary_writer`; when that id is taken, the next free one of `summary_writer_2`, `summary_writer_3`, … (an existing writer may hold an earlier run's package) |
| H_0 package | `strategy.md` (solve the task directly from the statement, one short paragraph), `examples.md` (`entries: []`), `checklist.md` (`checks: []`) |
| Parameters | 2 generations, alternating selection (gen 1 greedy on H_1, gen 2 weighted random), children per parent 1 |
| Budget | (1 + 2) × 6 × 1 = 18 Target executions and 2 Modifier calls |

If `PROJECT_DIR/benchmarks/precise-summary/` exists, reuse it unchanged when it is published and
its case ids and statements match that definition, and say so; otherwise stop and ask. Name the
Target you used in the report.

## Run

1. Initialize H_0 (`references/initialization.md`), snapshot, and measure generation 0's matrix.
2. Generation 1, greedy: the parent is H_1. Dispatch the Modifier with H_1's package, its archive
   record and the failed cases' public statements; apply the surviving edits, snapshot, measure.
3. Generation 2, weighted random: draw the parent from the archive by the smoke weights; the
   Modifier proposes against that parent; apply, snapshot, measure.
4. Restore the best variant, and report the archive (both generations with their selection modes),
   both matrices, the best variant with its delta against H_1, and the cost.

An improvement is the demo's happy path, not its success condition: the demo checks that the loop
runs end to end with every record in place. A tie or a loss is reported as it measured.
