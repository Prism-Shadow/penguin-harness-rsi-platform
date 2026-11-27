/**
 * What the page reads from the plugin library (`GET /api/plugins`): the Optimize tab's methods and
 * which plugin to install for a missing Skill. Moved from the server module (and before it, the
 * Web App's lib/rsi-methods.ts): the page now reads the library itself.
 *
 * The methods are one per RSI toolkit — a plugin of the library's `rsi` category whose name ends
 * in `-rsi-toolkit`, the library's naming rule for toolkits (this plugin is filed under `rsi` too,
 * and is no toolkit). Nothing here lists the toolkits, so one an admin installs is offered the next
 * time the page reads, and one that is removed is gone.
 *
 * The default toolkit is the product's own loop, told apart by its plugin name: it comes first,
 * keeps the form the tab has always had, and preselects its optimizer beside the evaluator this
 * plugin ships. Every other toolkit runs its paper's loop through one Skill of its own: the one
 * named like the plugin, else the first Skill its quick start preselects that it ships, else its
 * only Skill. A plugin none of these settles is not offered.
 */
import type { WorkbenchMethod } from "../api";
import type { LibraryPluginView, PluginsView } from "./api";

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

/** The Skill a paper toolkit runs, or null when its manifest does not settle one. */
function paperSkill(plugin: LibraryPluginView): string | null {
  const shipped = plugin.skills.map((skill) => skill.name);
  if (shipped.includes(plugin.name)) return plugin.name;
  const preselected = plugin.quickStart?.skills?.find((skill) => shipped.includes(skill));
  if (preselected !== undefined) return preselected;
  return shipped.length === 1 ? shipped[0]! : null;
}

/** The Optimize tab's methods for the library: the default first, the rest in library order. */
export function rsiMethods(library: PluginsView): WorkbenchMethod[] {
  const methods: WorkbenchMethod[] = [];
  for (const group of library.groups) {
    if (group.id !== RSI_CATEGORY) continue;
    for (const plugin of group.plugins) {
      if (!plugin.name.endsWith(TOOLKIT_SUFFIX)) continue;
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
  }
  return methods.sort((a, b) => Number(b.kind === "default") - Number(a.kind === "default"));
}

/**
 * The plugin to install for each Skill the library ships: this plugin for the evaluation and
 * design Skills when the library carries it, else the first plugin that ships the Skill.
 */
export function skillPlugins(library: PluginsView): Record<string, string> {
  const out: Record<string, string> = {};
  const all = library.groups.flatMap((group) => group.plugins);
  for (const plugin of all) {
    for (const skill of plugin.skills) out[skill.name] ??= plugin.name;
  }
  if (all.some((plugin) => plugin.name === WORKBENCH_PLUGIN)) {
    out[EVALUATION_SKILL] = WORKBENCH_PLUGIN;
    out[DESIGN_SKILL] = WORKBENCH_PLUGIN;
  }
  return out;
}
