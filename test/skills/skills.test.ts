/**
 * The Skills this package ships, as the plugin library and an Agent read them: the workbench's own
 * under `skills/<name>/` and each RSI toolkit's under `plugins/<toolkit>/skills/<name>/`.
 *
 * For every shipped `SKILL.md`:
 * - its frontmatter names the Skill as its folder does, describes it on one line, and carries a
 *   dated version (what an installed copy is compared against for updates);
 * - it has a "Before you start" section, which the harness's Skills share;
 * - every `reference/…` or `references/…` file it sends the reader to is in the package: its
 *   own, or, when the text names another Skill (`` `agent-evaluation`'s `reference/harbor.md` ``),
 *   that Skill's.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = path.join(import.meta.dirname, "..", "..");
const DATED_VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
/** A named reference file, with the Skill that owns it when the text names one. */
const NAMED_REFERENCE = /(?:`([\w-]+)`'s `)?(references?\/[\w.-]+\.md)/g;

interface ShippedSkill {
  /** The folder's path from the package root, "/"-separated. */
  label: string;
  name: string;
  dir: string;
}

function foldersIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name));
}

function shippedSkills(): ShippedSkill[] {
  const roots = [
    path.join(ROOT, "skills"),
    ...foldersIn(path.join(ROOT, "plugins")).map((plugin) => path.join(plugin, "skills")),
  ];
  return roots.flatMap(foldersIn).map((dir) => ({
    label: path.relative(ROOT, dir).split(path.sep).join("/"),
    name: path.basename(dir),
    dir,
  }));
}

function frontmatterOf(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) throw new Error("no frontmatter");
  return parseYaml(match[1]!) as Record<string, unknown>;
}

const SKILLS = shippedSkills();
const SKILL_DIRS = new Map(SKILLS.map((skill) => [skill.name, skill.dir]));

describe("the shipped Skills", () => {
  it("are the workbench's own and a Skill from every toolkit", () => {
    const labels = SKILLS.map((skill) => skill.label);
    expect(labels.filter((label) => label.startsWith("skills/"))).not.toEqual([]);
    for (const plugin of foldersIn(path.join(ROOT, "plugins")).map((p) => path.basename(p))) {
      const prefix = `plugins/${plugin}/skills/`;
      expect(
        labels.some((label) => label.startsWith(prefix)),
        plugin,
      ).toBe(true);
    }
  });
});

describe("every shipped Skill", () => {
  for (const { label, name, dir } of SKILLS) {
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");

    it(`${label} is named, described and versioned in its frontmatter`, () => {
      const meta = frontmatterOf(text);
      expect(meta.name).toBe(name);
      expect(typeof meta.description).toBe("string");
      expect((meta.description as string).trim()).not.toBe("");
      expect(meta.description as string).not.toContain("\n");
      expect(String(meta.version)).toMatch(DATED_VERSION);
    });

    it(`${label} says what to settle before starting`, () => {
      expect(text).toMatch(/^## Before you start$/m);
    });

    it(`${label} ships every reference it names`, () => {
      for (const [, owner, rel] of text.matchAll(NAMED_REFERENCE)) {
        const ownerDir = owner === undefined ? dir : SKILL_DIRS.get(owner);
        expect(ownerDir, `${owner}'s ${rel}: no such Skill in the package`).toBeDefined();
        expect(fs.existsSync(path.join(ownerDir!, rel!)), `${owner ?? name}'s ${rel}`).toBe(true);
      }
    });
  }
});
