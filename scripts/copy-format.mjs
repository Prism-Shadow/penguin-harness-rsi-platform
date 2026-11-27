/**
 * copy-format: the workbench's copy of the format, `workbenches/benchmark/lib/format/`, written
 * from `src/format/` — the source of the package's `./format` export.
 *
 *   node scripts/copy-format.mjs           # write the copy
 *   node scripts/copy-format.mjs --check   # fail when the copy on disk is not what it would write
 *
 * The workbench folder is all the handler has at runtime (the host copies it into each Agent and
 * compiles it alone), so it carries the format as source of its own. Each file is copied byte for
 * byte behind one line naming its source, with the two parser imports pointed at the vendored
 * copies beside it (lib/vendor, the same versions the lockfile pins for `./format`). The copy is
 * committed, so a checkout's handler compiles and its suites run before any build.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "format");
const TARGET = path.join(ROOT, "workbenches", "benchmark", "lib", "format");

/** The package imports the source makes, and the vendored module each becomes in the copy. */
const VENDORED = new Map([
  ["smol-toml", "../vendor/smol-toml/index.js"],
  ["yaml", "../vendor/yaml/index.js"],
]);

/** `text` of `src/format/<name>` as the copy holds it; Node's own modules stay as they are. */
function copied(name, text) {
  const rewritten = text.replace(/ from "([^"./][^"]*)";/g, (whole, specifier) => {
    if (specifier.startsWith("node:")) return whole;
    const vendored = VENDORED.get(specifier);
    if (vendored === undefined) {
      throw new Error(
        `src/format/${name} imports ${specifier}, which the workbench does not carry`,
      );
    }
    return ` from "${vendored}";`;
  });
  return `// Generated from src/format/${name} by scripts/copy-format.mjs: edit the source.\n${rewritten}`;
}

/** Every file the copy should hold, by name. */
async function expected() {
  const out = new Map();
  for (const name of (await fs.readdir(SOURCE)).sort()) {
    if (!name.endsWith(".ts")) continue;
    out.set(name, copied(name, await fs.readFile(path.join(SOURCE, name), "utf8")));
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { check: { type: "boolean" } } });
  const files = await expected();
  const present = await fs.readdir(TARGET).catch(() => []);
  if (values.check) {
    const stale = [];
    for (const [name, text] of files) {
      const onDisk = await fs.readFile(path.join(TARGET, name), "utf8").catch(() => null);
      if (onDisk !== text) stale.push(name);
    }
    for (const name of present) if (!files.has(name)) stale.push(name);
    if (stale.length > 0) {
      console.error(
        `workbenches/benchmark/lib/format/ differs from src/format/ (${stale.join(", ")}): run node scripts/copy-format.mjs`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`workbenches/benchmark/lib/format/ is src/format/'s copy (${files.size} files)`);
    return;
  }
  await fs.mkdir(TARGET, { recursive: true });
  for (const name of present) {
    if (!files.has(name)) await fs.rm(path.join(TARGET, name), { recursive: true, force: true });
  }
  for (const [name, text] of files) await fs.writeFile(path.join(TARGET, name), text, "utf8");
  console.log(`workbenches/benchmark/lib/format/: ${files.size} files from src/format/`);
}

await main();
