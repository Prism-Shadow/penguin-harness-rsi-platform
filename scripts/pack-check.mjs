/**
 * pack-check: what a release ships, checked after `pnpm build`.
 *
 *   node scripts/pack-check.mjs [--out <dir>]
 *
 * 1. The package a harness build can take as an external built-in plugin (the harness's
 *    scripts/lib/external-plugins.mjs) and the plugin index files as a resource package: no
 *    runtime `dependencies` or `optionalDependencies`, no `main` and no `.` export — only subpath
 *    exports: the code of `./format`, `./api` and `./prompts`, the published files of
 *    `./workbenches/*`, `./icon.svg` and `./package.json` — and the generated `ifaces.json` among
 *    its files.
 * 2. Each code export loads in plain Node, as a consumer imports it, with its declarations beside
 *    it; `./api` and `./prompts` import nothing at all (no `node:` module, no `require`), so a
 *    browser bundle can take them.
 * 3. The static probe, read without running the package, as the plugin library and the host's lock
 *    read it: `ifaces.json` carries data-only modules (nothing required, provided or bound) whose
 *    contributions are the card (category `rsi`, no `preinstall`, so preinstalled), the Skills
 *    (each with its SKILL.md) and the workbench, whose folder holds its manifest — one `Workbench`
 *    module whose tab renders as an iframe of a page that is built — its `index.ts`, its icon and
 *    its seeds with their catalog. The built page carries no Mermaid chunk, and its size is printed.
 *    Every file of the workbench and of each Skill installs as text (`requireText`: strict UTF-8,
 *    the harness library reader's rule), the toolkits' Skills included.
 * 4. `npm pack` twice gives the same bytes, for the package and every toolkit: the sha512 the
 *    plugin index and the harness's lock record is a property of the source, not of the run. The
 *    workbench travels without what a host writes into a loaded folder (`.build/`, `.harness/`).
 *    Every integrity is printed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`pack-check: ${message}`);
  process.exit(1);
}

const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

// 1. The package's shape.
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
for (const field of ["dependencies", "optionalDependencies"]) {
  if (pkg[field] !== undefined && Object.keys(pkg[field]).length > 0) {
    fail(`package.json declares ${field}; a built-in plugin bundles what it runs`);
  }
}
if (pkg.main !== undefined) fail("package.json names a main entry; the package has no code entry");
const exportKeys = Object.keys(pkg.exports ?? {});
if (exportKeys.some((key) => key === "." || !key.startsWith("./"))) {
  fail(
    `package.json exports ${exportKeys.join(", ")}: a resource package has subpath exports only`,
  );
}
/** The code exports: each one's folder under dist/, and a value it must export. */
const CODE_EXPORTS = [
  ["./format", "format", "parseScoreboard", false],
  ["./api", "api", "casePage", true],
  ["./prompts", "prompts", "buildRequest", true],
];
for (const [key, dir] of CODE_EXPORTS) {
  const entry = pkg.exports[key];
  if (entry?.import !== `./dist/${dir}/index.js` || entry?.types !== `./dist/${dir}/index.d.ts`) {
    fail(`package.json does not export ${key} from dist/${dir} with its types`);
  }
}
for (const file of [
  "ifaces.json",
  "workbenches",
  ...CODE_EXPORTS.map(([, dir]) => `dist/${dir}`),
]) {
  if (!pkg.files.includes(file)) fail(`package.json files does not ship ${file}`);
}

// 2. Each code export loads on its own; the browser-safe ones import nothing.
/** An import statement, a re-export from a module, a dynamic import or a require of one. */
const MODULE_IMPORT =
  /^\s*(?:import|export)\b[^;]*\bfrom\s*["']|^\s*import\s*["']|\bimport\s*\(\s*["'`]|\brequire\s*\(\s*["'`]/m;
for (const [key, dir, value, browser] of CODE_EXPORTS) {
  const file = path.join(ROOT, "dist", dir, "index.js");
  const loaded = await import(pathToFileURL(file).href);
  if (typeof loaded[value] !== "function") fail(`${key} does not export ${value}`);
  if (!(await exists(path.join(ROOT, "dist", dir, "index.d.ts"))))
    fail(`${key} has no declarations`);
  if (browser && MODULE_IMPORT.test(await fs.readFile(file, "utf8"))) {
    fail(`${key} imports a module, which a browser bundle may not resolve`);
  }
}

// 3. The static probe.
const table = JSON.parse(await fs.readFile(path.join(ROOT, "ifaces.json"), "utf8"));
const manifests = Object.entries(table.modules ?? {});
if (manifests.length === 0) fail("ifaces.json carries no module");
// A data-only component requires nothing, has no children, and provides only itself: an interface
// with no methods and no slots, so nothing of it ever runs.
for (const [key, manifest] of manifests) {
  if (Object.keys(manifest.requires ?? {}).length > 0) fail(`${key} requires something`);
  if ((manifest.children ?? []).length > 0) fail(`${key} has child modules`);
  for (const provided of Object.values(manifest.provides ?? {})) {
    const iface = table.ifaces?.[provided];
    if (iface === undefined)
      fail(`${key} provides ${provided}, which ifaces.json does not declare`);
    if (Object.keys(iface.methods ?? {}).length > 0 || Object.keys(iface.slots ?? {}).length > 0) {
      fail(`${key} provides ${provided} with members: the package's modules are data only`);
    }
  }
}
const contributions = manifests.flatMap(([, m]) =>
  Object.entries(m.contributes ?? {}).flatMap(([slot, list]) => list.map((c) => ({ slot, ...c }))),
);
const find = (slot) => contributions.filter((c) => c.slot === slot);
const cards = find("PluginLibraryModule.cards");
if (cards.length !== 1 || cards[0].category !== "rsi" || "preinstall" in cards[0]) {
  fail("the package's one card is not an rsi card that leaves preinstall to its default");
}
const skills = find("PluginLibraryModule.skills");
if (skills.length === 0) fail("the card ships no Skill");
for (const skill of skills) {
  if (!(await exists(path.join(ROOT, skill.path, "SKILL.md")))) {
    fail(`skill ${skill.name} has no ${skill.path}/SKILL.md`);
  }
}
const workbenches = find("PluginLibraryModule.workbenches");
if (workbenches.length !== 1 || workbenches[0].name !== "benchmark") {
  fail("the package contributes no benchmark workbench");
}
const folder = path.join(ROOT, workbenches[0].path);
const manifest = JSON.parse(await fs.readFile(path.join(folder, "package.json"), "utf8"));
const modules = manifest.penguin?.modules ?? [];
const root = modules.find((m) => m.name === "Workbench");
if (modules.length !== 1 || root === undefined) fail("the workbench is not one Workbench module");
const tabs = root.contributes?.["WebModule.sessionTabs"] ?? [];
if (tabs.length === 0) fail("the workbench contributes no tab");
for (const tab of tabs) {
  const src = tab.renderer?.iframe?.src;
  if (typeof src !== "string" || Object.keys(tab.renderer).length !== 1) {
    fail(`tab ${tab.id} does not render as an iframe`);
  }
  if (!(await exists(path.join(folder, src)))) fail(`tab ${tab.id}: ${src} is not built`);
}
for (const rel of [
  "index.ts",
  manifest.penguin.icon,
  manifest.penguin.appCenter?.icon,
  "seeds/catalog.json",
]) {
  if (typeof rel !== "string" || !(await exists(path.join(folder, rel)))) {
    fail(`the workbench folder has no ${rel}`);
  }
}
const ui = path.join(folder, "ui");
let uiBytes = 0;
let uiFiles = 0;
for (const entry of await fs.readdir(ui, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  // Mermaid's own chunks are named after it and after its diagrams (`flowDiagram-…`).
  if (/mermaid|diagram|cytoscape/i.test(entry.name)) {
    fail(`the page carries a Mermaid chunk: ${entry.name}`);
  }
  uiBytes += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
  uiFiles += 1;
}

/**
 * The files under `dir` an install would not carry, by path: the harness's library reader
 * (packages/core plugin/library-reader.ts `readDirFiles`) copies a workbench's, a Skill's and a
 * hook package's files as text — every regular file whose bytes decode as strict UTF-8
 * (`TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`), whatever its extension — and leaves
 * out anything else with a warning ("… is not a text file; it is not installed"), which is fatal
 * for a built-in plugin. A link or other special entry it skips silently; here it fails too, since
 * the copy would lose it.
 */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
async function notInstalledAsText(dir, rel = "") {
  const out = [];
  for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await notInstalledAsText(dir, child)));
    else if (!entry.isFile()) out.push(`${child} (not a regular file)`);
    else {
      try {
        strictUtf8.decode(await fs.readFile(path.join(dir, child)));
      } catch {
        out.push(child);
      }
    }
  }
  return out;
}

/** Fails when an install of `dir` (named `what`) would leave a file out. */
async function requireText(dir, what) {
  const left = await notInstalledAsText(dir);
  if (left.length > 0) {
    fail(`${what} holds files an install does not carry as text: ${left.slice(0, 10).join(", ")}`);
  }
}

await requireText(folder, `the workbench ${workbenches[0].path}`);
for (const skill of skills) await requireText(path.join(ROOT, skill.path), `skill ${skill.name}`);
console.log(
  `probe: ${manifests.length} data-only module(s), ${contributions.length} contributions; ` +
    `workbench ${manifest.name} ${manifest.penguin.version}; ui/ ${uiFiles} files, ${uiBytes} bytes`,
);

// 4. Two packs, one set of bytes.
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out
  ? path.resolve(values.out)
  : await fs.mkdtemp(path.join(os.tmpdir(), "rsi-pack-"));
const toolkits = (await fs.readdir(path.join(ROOT, "plugins"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(ROOT, "plugins", entry.name))
  .sort();

for (const cwd of [ROOT, ...toolkits]) {
  const own = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
  const required = ["package.json", "LICENSE", "ifaces.json", "icon.svg"];
  if (cwd === ROOT) {
    required.push(
      ...CODE_EXPORTS.flatMap(([, dir]) => [`dist/${dir}/index.js`, `dist/${dir}/index.d.ts`]),
      `${workbenches[0].path}/package.json`,
      `${workbenches[0].path}/index.ts`,
      `${workbenches[0].path}/ui/index.html`,
      `${workbenches[0].path}/seeds/catalog.json`,
    );
  } else {
    const { modules } = JSON.parse(await fs.readFile(path.join(cwd, "ifaces.json"), "utf8"));
    const parts = Object.values(modules).map((entry) => entry.contributes ?? {});
    const toolkitCards = parts.flatMap((entry) => entry["PluginLibraryModule.cards"] ?? []);
    const toolkitSkills = parts.flatMap((entry) => entry["PluginLibraryModule.skills"] ?? []);
    if (
      own.name !== "@penguinharness/" + path.basename(cwd) ||
      toolkitCards.length !== 1 ||
      toolkitCards[0].category !== "rsi" ||
      toolkitSkills.length === 0
    ) {
      fail(`${own.name}: expected a named RSI toolkit with a library card and Skills`);
    }
    for (const skill of toolkitSkills) {
      required.push(path.posix.join(skill.path, "SKILL.md"));
      await requireText(path.join(cwd, skill.path), `${own.name} skill ${skill.name}`);
    }
  }
  let firstIntegrity;
  for (const run of [1, 2]) {
    const dest = path.join(out, `pack-${run}`);
    await fs.mkdir(dest, { recursive: true });
    const [info] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", dest], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    for (const entry of required) {
      if (!info.files.some((file) => file.path === entry)) fail(`${own.name}: missing ${entry}`);
    }
    const written = info.files.find((file) => /(^|\/)\.(build|harness)\//.test(file.path));
    if (written !== undefined) fail(`${own.name}: ships ${written.path}, which a host writes`);
    const bytes = await fs.readFile(path.join(dest, info.filename));
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (integrity !== info.integrity || (run === 2 && integrity !== firstIntegrity)) {
      fail(`${info.filename}: package integrity differs`);
    }
    firstIntegrity = integrity;
    console.log(
      `pack ${run}: ${info.filename} ${integrity} (${bytes.length} bytes, ${info.entryCount} files)`,
    );
  }
}
