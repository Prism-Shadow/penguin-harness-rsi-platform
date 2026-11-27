import { defineConfig } from "tsup";

/**
 * The package's three code exports, each self-contained in a folder of `dist/` of its own, with
 * its declarations:
 *
 * - `./format` (src/format): the manifest and scoreboard format, for Node. What it imports
 *   (smol-toml, yaml) is bundled in, so the published package has no runtime dependencies; the
 *   workbench's handler carries its own copy of the same sources (scripts/copy-format.mjs).
 * - `./api` and `./prompts`: the handler's HTTP contract and the prompts its tasks send, built
 *   from the workbench folder's own modules (workbenches/benchmark/lib/api.ts, prompts.ts), which
 *   the handler keeps importing by relative path. Neither imports anything of Node's, and they are
 *   built for any platform with nothing in front of them, so a browser bundle (the harness's
 *   component gallery) can take them.
 */
export default defineConfig([
  {
    entry: { index: "src/format/index.ts" },
    outDir: "dist/format",
    format: ["esm"],
    platform: "node",
    target: "node24",
    splitting: false,
    clean: true,
    sourcemap: false,
    dts: true,
    // Bundled CommonJS (yaml) requires Node's builtins at load; an ES module has no `require` of
    // its own, so the bundle makes one, or loading it throws "Dynamic require … is not supported".
    banner: {
      js: 'import { createRequire as __rsiCreateRequire } from "node:module"; const require = __rsiCreateRequire(import.meta.url);',
    },
  },
  ...(
    [
      ["api", "workbenches/benchmark/lib/api.ts"],
      ["prompts", "workbenches/benchmark/lib/prompts.ts"],
    ] as const
  ).map(([name, entry]) => ({
    entry: { index: entry },
    outDir: `dist/${name}`,
    format: ["esm" as const],
    platform: "neutral" as const,
    target: "es2022",
    splitting: false,
    clean: true,
    sourcemap: false,
    dts: true,
  })),
]);
