/**
 * The evaluation reference several RSI toolkits share. Within each group below, every toolkit
 * ships the same `references/evaluation.md`, byte for byte, so a fix made to one copy is made to
 * all of them. RRSI and SkillOpt extend the protocol in copies of their own and are in no group.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..", "..");

/** The toolkits that ship one shared copy, by the id in `plugins/<id>-rsi-toolkit/`. */
const SHARED_COPIES: readonly (readonly [string, ...string[]])[] = [
  ["ace", "ape", "awm", "opro"],
  ["openskill", "skilladam", "trace"],
];

function evaluationReference(toolkit: string): Buffer {
  const skill = `${toolkit}-rsi-toolkit`;
  return fs.readFileSync(
    path.join(ROOT, "plugins", skill, "skills", skill, "references", "evaluation.md"),
  );
}

describe("the evaluation reference the toolkits share", () => {
  for (const [first, ...others] of SHARED_COPIES) {
    it(`is the same file in ${[first, ...others].join(", ")}`, () => {
      const expected = evaluationReference(first);
      for (const toolkit of others) {
        const copy = evaluationReference(toolkit);
        expect(copy.equals(expected), `${toolkit}'s copy differs from ${first}'s`).toBe(true);
      }
    });
  }
});
