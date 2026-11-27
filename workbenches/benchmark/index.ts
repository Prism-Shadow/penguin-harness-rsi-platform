/**
 * The Self-Evolution Workbench's handler (PRFC-0036): the Benchmarks of the Agent this workbench is
 * installed on, kept in its agent-level data folder, served to the page in `ui/` under the
 * workbench's API mount (lib/routes.ts). The host compiles this folder alone, under its own
 * options, so everything the handler needs is TypeScript in it: the format (lib/format, a copy of
 * the package's `./format`), the TOML and YAML parsers (lib/vendor) and a zip container over
 * `node:zlib` (lib/zip.ts).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
import { createWorkbench } from "./lib/workbench.js";

/**
 * This workbench's folder. The host runs the emitted file from `<workbench>/.build/<revision>/`;
 * run from source, the file is in the folder itself.
 */
function workbenchFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parent = path.dirname(here);
  return path.basename(parent) === ".build" ? path.dirname(parent) : here;
}

export default {
  modules: {
    Workbench: {
      create({ use }) {
        return {
          api: {
            main: createWorkbench(use.host, {
              seedsDir: path.join(workbenchFolder(), "seeds"),
            }),
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
