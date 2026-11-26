/**
 * The workbench's page (src/ui) → workbenches/benchmark/ui/: React, @prismshadow/penguin-ui and
 * its stylesheet bundled in, and the icon from src/ui/public. The host serves the folder under the
 * workbench (`…/workbenches/benchmark/ui/`), so every asset URL is relative (`base: "./"`).
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { penguinUi } from "./src/ui/vite-penguin-ui-link";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  root: here("./src/ui"),
  base: "./",
  // penguinUi(): the stylesheet link marked `data-penguin-ui`, no highlighter languages, no Mermaid.
  plugins: [react(), tailwindcss(), ...penguinUi()],
  build: {
    outDir: here("./workbenches/benchmark/ui"),
    emptyOutDir: true,
    sourcemap: false,
    // Hashed names; the same sources build the same bytes, which `npm pack` twice relies on.
    assetsDir: "assets",
  },
});
