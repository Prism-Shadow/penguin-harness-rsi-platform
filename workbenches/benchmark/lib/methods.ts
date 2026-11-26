/**
 * The Skills and the plugin the prompts name (prompts.ts). The page reads the Optimize tab's
 * methods from the plugin library itself (`GET /api/plugins`); the handler only tells the default
 * loop, which keeps the form the tab has always had, from a paper's toolkit by its plugin name.
 */

/** The plugin of the product's own trial → reflect → improve loop. */
export const DEFAULT_TOOLKIT_PLUGIN = "default-rsi-toolkit";
/** The default loop's optimizer Skill, shipped in the default toolkit. */
export const OPTIMIZATION_SKILL = "agent-optimization";
/** The Skill every evaluation goes through, shipped in this plugin. */
export const EVALUATION_SKILL = "agent-evaluation";
/** The Skill that designs and imports Benchmarks, shipped in this plugin. */
export const DESIGN_SKILL = "benchmark-design";
