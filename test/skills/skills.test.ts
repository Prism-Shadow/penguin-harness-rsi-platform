/**
 * The Skills this package ships, as the plugin library and an Agent read them.
 *
 * For every `skills/<name>/SKILL.md` the card contributes:
 * - its frontmatter names the Skill as its folder does, describes it on one line, and carries a
 *   dated version (what an installed copy is compared against for updates);
 * - it opens with a "Before you start" section, which the harness's Skills share;
 * - every `reference/…` file it sends the reader to is in the package.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const SKILLS = path.join(import.meta.dirname, "..", "..", "skills");
const DATED_VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

function frontmatterOf(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) throw new Error("no frontmatter");
  return parseYaml(match[1]!) as Record<string, unknown>;
}

describe("every shipped Skill", () => {
  for (const name of fs.readdirSync(SKILLS)) {
    const dir = path.join(SKILLS, name);
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");

    it(`${name} is named, described and versioned in its frontmatter`, () => {
      const meta = frontmatterOf(text);
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe("string");
      expect((meta.description as string).trim()).not.toBe("");
      expect(meta.description as string).not.toContain("\n");
      expect(String(meta.version)).toMatch(DATED_VERSION);
    });

    it(`${name} says what to settle before starting`, () => {
      expect(text).toMatch(/^## Before you start$/m);
    });

    it(`${name} ships every reference it names`, () => {
      const named = new Set(text.match(/reference\/[\w.-]+\.md/g) ?? []);
      for (const rel of named) {
        expect(fs.existsSync(path.join(dir, rel)), rel).toBe(true);
      }
    });
  }
});
