/**
 * The iframe app (src/ui) → ui/: React, @prismshadow/penguin-ui and its stylesheet bundled in.
 * The server module serves the folder at /api/rsi-workbench/ui/ (src/server/ui-files.ts), so every
 * asset URL is relative (`base: "./"`).
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
  // penguinUi(): the stylesheet link marked `data-penguin-ui`, and no highlighter languages.
  plugins: [react(), tailwindcss(), ...penguinUi()],
  build: {
    outDir: here("./ui"),
    emptyOutDir: true,
    sourcemap: false,
    // Hashed names; the same sources build the same bytes, which `npm pack` twice relies on.
    assetsDir: "assets",
  },
});
