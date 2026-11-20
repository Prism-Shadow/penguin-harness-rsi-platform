/**
 * The methods the Optimize tab offers, built from the plugin library each time the page reads its
 * context: one per RSI toolkit — a plugin of the library's `rsi` category whose name ends in
 * `-rsi-toolkit`, the library's naming rule for toolkits (this plugin is filed under `rsi` too,
 * and is no toolkit). Nothing here lists the toolkits, so one an admin installs is offered the next
 * time the page reads, and one that is removed is gone. Moved from the Web App (lib/rsi-methods.ts).
 *
 * The default toolkit is the product's own loop, told apart by its plugin name: it comes first,
 * keeps the form the tab has always had, and preselects its optimizer beside the evaluator this
 * plugin ships. Every other toolkit runs its paper's loop through one Skill of its own: the one
 * named like the plugin, else the first Skill its quick start preselects that it ships, else its
 * only Skill. A plugin none of these settles is not offered.
 */
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import type { WorkbenchMethod } from "../api.js";

/** The plugin library's category the self-evolution toolkits are filed under. */
export const RSI_CATEGORY = "rsi";

/** What a toolkit's plugin name ends in. */
const TOOLKIT_SUFFIX = "-rsi-toolkit";

/** The plugin of the product's own trial → reflect → improve loop. */
export const DEFAULT_TOOLKIT_PLUGIN = "default-rsi-toolkit";
/** The default loop's optimizer Skill, shipped in the default toolkit. */
export const OPTIMIZATION_SKILL = "agent-optimization";
/** The Skill every evaluation goes through, shipped in this plugin. */
export const EVALUATION_SKILL = "agent-evaluation";
/** The Skill that designs and imports Benchmarks, shipped in this plugin. */
export const DESIGN_SKILL = "benchmark-design";
/** This plugin's name in the library, which a missing evaluation or design Skill installs. */
export const WORKBENCH_PLUGIN = "rsi-workbench";

/** The part of a library entry the methods read. */
type ToolkitPlugin = Pick<
  LibraryPlugin,
  | "name"
  | "title"
  | "titleZh"
  | "description"
  | "descriptionZh"
  | "shortDescription"
  | "shortDescriptionZh"
  | "category"
  | "quickStart"
> & { skills: readonly { name: string }[] };

/** The Skill a paper toolkit runs, or null when its manifest does not settle one. */
function paperSkill(plugin: ToolkitPlugin): string | null {
  const shipped = plugin.skills.map((skill) => skill.name);
  if (shipped.includes(plugin.name)) return plugin.name;
  const preselected = plugin.quickStart?.skills?.find((skill) => shipped.includes(skill));
  if (preselected !== undefined) return preselected;
  return shipped.length === 1 ? shipped[0]! : null;
}

/** The Optimize tab's methods for these library entries: the default first, the rest by name. */
export function rsiMethods(plugins: readonly ToolkitPlugin[]): WorkbenchMethod[] {
  const methods: WorkbenchMethod[] = [];
  for (const plugin of plugins) {
    if (plugin.category !== RSI_CATEGORY || !plugin.name.endsWith(TOOLKIT_SUFFIX)) continue;
    const isDefault = plugin.name === DEFAULT_TOOLKIT_PLUGIN;
    const skill = isDefault ? OPTIMIZATION_SKILL : paperSkill(plugin);
    if (skill === null) continue;
    const label = plugin.title || plugin.name;
    const hint = plugin.shortDescription || plugin.description || "";
    methods.push({
      plugin: plugin.name,
      kind: isDefault ? "default" : "paper",
      skill,
      label,
      labelZh: plugin.titleZh || label,
      hint,
      hintZh: plugin.shortDescriptionZh || plugin.descriptionZh || hint,
    });
  }
  return methods.sort((a, b) => Number(b.kind === "default") - Number(a.kind === "default"));
}

/** The plugin that ships `skill` among the library entries, for a missing-Skill refusal. */
export function pluginShipping(plugins: readonly ToolkitPlugin[], skill: string): string | null {
  if (skill === EVALUATION_SKILL || skill === DESIGN_SKILL) return WORKBENCH_PLUGIN;
  return plugins.find((plugin) => plugin.skills.some((s) => s.name === skill))?.name ?? null;
}
