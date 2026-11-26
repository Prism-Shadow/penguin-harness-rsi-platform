import { defineConfig } from "tsup";

// The pure `./format` export, self-contained: what it imports (smol-toml, yaml) is bundled into
// dist/format, so the published package has no runtime dependencies. The workbench's handler
// carries its own copy of the same sources (scripts/copy-format.mjs).
export default defineConfig({
  entry: { "format/index": "src/format/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  splitting: false,
  clean: true,
  sourcemap: false,
  dts: { entry: { "format/index": "src/format/index.ts" } },
  // Bundled CommonJS (yaml) requires Node's builtins at load; an ES module has no `require` of
  // its own, so the bundle makes one, or loading it throws "Dynamic require … is not supported".
  banner: {
    js: 'import { createRequire as __rsiCreateRequire } from "node:module"; const require = __rsiCreateRequire(import.meta.url);',
  },
});
