/**
 * The package as the plugin library and the host read it: the default export of `src/index.ts`,
 * and the workbench folder it names.
 *
 * Given the package as it ships:
 * - When the library reads the default export, it is data only — one component with nothing to
 *   run — that names the card (category `rsi`, preinstalled by the library's default), every
 *   Skill folder of the package, each with its `SKILL.md`, and the workbench folder.
 * - When the host reads that folder, its manifest has the workbench module take the host's
 *   `WorkbenchHost` from `Host` and provide the `WorkbenchMain` handler; the handler, loaded
 *   through the folder's `index.ts` default export, seeds the Benchmarks the folder ships into its
 *   data folder on the first load and lists every one of them as usable.
 */
import fs from "node:fs";
import path from "node:path";
import { moduleMetaOf } from "@prismshadow/penguin-core/kernel";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import plugin, { RsiWorkbenchPlugin } from "../../src/index.js";
import type { BenchmarksResponse } from "../../workbenches/benchmark/lib/api.js";
import { createTestWorkbench, statusOf } from "../helpers/workbench.js";

const ROOT = path.join(import.meta.dirname, "..", "..");

type Contribution = { id: string } & Record<string, unknown>;

/** What the default export contributes to `slot`, as the library reads it off the class. */
function contributed(slot: string): Contribution[] {
  return [...(moduleMetaOf(RsiWorkbenchPlugin).contributes?.[slot] ?? [])] as Contribution[];
}

function foldersIn(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("the package's default export", () => {
  it("is data only: one component that has nothing to run", () => {
    expect(plugin.modules).toEqual([RsiWorkbenchPlugin]);
    expect(moduleMetaOf(RsiWorkbenchPlugin).kind).toBe("component");
    expect(Object.getOwnPropertyNames(RsiWorkbenchPlugin.prototype)).toEqual(["constructor"]);
  });

  it("names the card in the rsi category, leaving preinstall to the default", () => {
    const cards = contributed("PluginLibraryModule.cards");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ category: "rsi" });
    expect(cards[0]).not.toHaveProperty("preinstall");
  });

  it("names every Skill folder of the package, each with its SKILL.md", () => {
    const skills = contributed("PluginLibraryModule.skills");

    expect(skills.map((skill) => skill.name).sort()).toEqual(foldersIn(path.join(ROOT, "skills")));
    for (const skill of skills) {
      const text = fs.readFileSync(path.join(ROOT, String(skill.path), "SKILL.md"), "utf8");
      const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!) as { name: string };
      expect(frontmatter.name, String(skill.path)).toBe(skill.name);
    }
  });

  it("names the workbench folder, whose module takes the host from Host and provides the handler", () => {
    const workbenches = contributed("PluginLibraryModule.workbenches");

    expect(workbenches).toHaveLength(1);
    const folder = path.join(ROOT, String(workbenches[0]!.path));
    expect(fs.existsSync(path.join(folder, "index.ts"))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8")) as {
      penguin: { modules: Array<{ name: string; requires?: unknown; provides?: unknown }> };
    };
    const workbenchModule = manifest.penguin.modules.find((m) => m.name === "Workbench");
    expect(workbenchModule).toMatchObject({
      requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
      provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
    });
  });
});

describe("the workbench as the host loads it", () => {
  it("seeds the Benchmarks its folder ships on the first load and lists every one as usable", async () => {
    const wb = await createTestWorkbench({ asShipped: true });
    try {
      const res = await wb.get("/benchmarks");

      expect(statusOf(res)).toBe(200);
      const { benchmarks, dir } = res.body as BenchmarksResponse;
      expect(dir).toBe(wb.dataDir);
      expect(benchmarks.map((b) => b.id).sort()).toEqual(
        foldersIn(path.join(ROOT, "workbenches", "benchmark", "seeds")),
      );
      for (const benchmark of benchmarks) {
        expect(benchmark.manifestError, benchmark.id).toBeUndefined();
        expect(benchmark.status, benchmark.id).toBe("published");
        expect(benchmark.caseCount, benchmark.id).toBeGreaterThan(0);
      }
      expect(wb.host.lines).not.toContainEqual(expect.stringContaining("Could not seed"));
    } finally {
      await wb.dispose();
    }
  });
});
