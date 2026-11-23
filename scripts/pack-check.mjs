/**
 * pack-check: what a release ships, checked after `pnpm build`.
 *
 *   node scripts/pack-check.mjs [--out <dir>]
 *
 * 1. The package a harness build can take as an external built-in plugin (the harness's
 *    scripts/lib/external-plugins.mjs): no runtime `dependencies` or `optionalDependencies`, a
 *    code entry, and the generated `ifaces.json` among its files.
 * 2. Both entries load in plain Node (a bundle that cannot load fails here, not in a host), and the
 *    static probe: `ifaces.json` carries the manifests of exactly the modules the default
 *    export names — the card (`preinstall: true`, category `rsi`) and its Skills, and the app with
 *    its iframe page marked as a system app and its `SystemAppModule.apps` declaration — read
 *    without running the package, as the plugin library and the host's lock read it.
 * 3. `npm pack` twice gives the same bytes: the sha512 the plugin index and the harness's lock
 *    record is a property of the source, not of the run. Both integrities are printed.
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

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
for (const field of ["dependencies", "optionalDependencies"]) {
  if (pkg[field] !== undefined && Object.keys(pkg[field]).length > 0) {
    fail(`package.json declares ${field}; a built-in plugin bundles what it runs`);
  }
}
if (!pkg.files.includes("ifaces.json")) fail("package.json files does not ship ifaces.json");
if (pkg.exports?.["."]?.import !== "./dist/index.js") fail("no code entry at ./dist/index.js");

// The static probe.
const table = JSON.parse(await fs.readFile(path.join(ROOT, "ifaces.json"), "utf8"));
const manifests = table.modules ?? {};
const names = Object.keys(manifests).map((key) => key.split("#").pop());
const { default: plugin } = await import(pathToFileURL(path.join(ROOT, "dist", "index.js")).href);
const exported = (plugin?.modules ?? []).map((cls) => cls.name);
// The `./format` export loads on its own, as a consumer imports it.
const format = await import(pathToFileURL(path.join(ROOT, "dist", "format", "index.js")).href);
if (typeof format.parseScoreboard !== "function") fail("./format does not export parseScoreboard");
if (exported.length === 0) fail("the default export names no module");
for (const name of exported) {
  if (!names.includes(name)) fail(`ifaces.json has no manifest for ${name}`);
}
const contributions = Object.values(manifests).flatMap((m) =>
  Object.entries(m.contributes ?? {}).flatMap(([slot, list]) => list.map((c) => ({ slot, ...c }))),
);
const find = (slot) => contributions.filter((c) => c.slot === slot);
const card = find("PluginLibraryModule.cards")[0];
if (card?.preinstall !== true || card?.category !== "rsi") {
  fail("the card is not a preinstalled rsi card");
}
const page = find("WebModule.pages").find((p) => p.key === "benchmark");
if (page?.app === undefined || page?.renderer?.iframe?.src === undefined) {
  fail("the benchmark page is not an iframe system app");
}
if (!find("SystemAppModule.apps").some((a) => a.app === page.key)) {
  fail("no SystemAppModule.apps declaration for the benchmark page");
}
for (const skill of find("PluginLibraryModule.skills")) {
  await fs
    .access(path.join(ROOT, skill.path, "SKILL.md"))
    .catch(() => fail(`skill ${skill.name} has no ${skill.path}/SKILL.md`));
}
for (const seeds of find("ProjectsModule.appSeeds")) {
  await fs.access(path.join(ROOT, seeds.path)).catch(() => fail(`no seeds at ${seeds.path}`));
}
await fs
  .access(path.join(ROOT, "ui", "index.html"))
  .catch(() => fail("ui/index.html is not built"));
console.log(`probe: modules ${exported.join(", ")}; ${contributions.length} contributions`);

// Two packs, one set of bytes.
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out
  ? path.resolve(values.out)
  : await fs.mkdtemp(path.join(os.tmpdir(), "rsi-pack-"));
const toolkits = (await fs.readdir(path.join(ROOT, "plugins"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(ROOT, "plugins", entry.name))
  .sort();

for (const cwd of [ROOT, ...toolkits]) {
  const manifest = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
  const required = ["package.json", "LICENSE", "ifaces.json", "icon.svg"];
  if (cwd !== ROOT) {
    const { modules } = JSON.parse(await fs.readFile(path.join(cwd, "ifaces.json"), "utf8"));
    const contributions = Object.values(modules).map((entry) => entry.contributes ?? {});
    const cards = contributions.flatMap((entry) => entry["PluginLibraryModule.cards"] ?? []);
    const skills = contributions.flatMap((entry) => entry["PluginLibraryModule.skills"] ?? []);
    if (
      manifest.name !== "@penguinharness/" + path.basename(cwd) ||
      cards.length !== 1 ||
      cards[0].category !== "rsi" ||
      skills.length === 0
    ) {
      fail(`${manifest.name}: expected a named RSI toolkit with a library card and Skills`);
    }
    for (const skill of skills) required.push(path.posix.join(skill.path, "SKILL.md"));
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
      if (!info.files.some((file) => file.path === entry))
        fail(`${manifest.name}: missing ${entry}`);
    }
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
