import { defineConfig } from "tsup";

// The server module and the pure `./format` export, each self-contained: everything they import
// (hono, fflate, smol-toml, yaml, the kernel's decorators) is bundled into dist/, so the published
// package has no runtime dependencies and shares nothing with the host but the interfaces it
// declares (src/server/host.ts).
export default defineConfig({
  entry: { index: "src/index.ts", "format/index": "src/format/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  splitting: false,
  clean: true,
  sourcemap: false,
  dts: { entry: { "format/index": "src/format/index.ts" } },
  // Bundled CommonJS (yaml) requires Node's builtins at load; an ES module has no `require` of
  // its own, so each bundle makes one, or loading it throws "Dynamic require … is not supported".
  banner: {
    js: 'import { createRequire as __rsiCreateRequire } from "node:module"; const require = __rsiCreateRequire(import.meta.url);',
  },
});
