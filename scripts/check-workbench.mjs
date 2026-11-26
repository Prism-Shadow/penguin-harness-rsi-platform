/**
 * check-workbench: compiles the workbench's handler the way the host does, then loads what it
 * emitted and asks it one question.
 *
 *   node scripts/check-workbench.mjs
 *
 * The host checks and transpiles `workbenches/benchmark/index.ts` itself on every load
 * (@prismshadow/penguin-server workbenches/compile.ts): one program from the entry and whatever it
 * imports, under options the host fixes — `strict`, `module: NodeNext`, Node's declarations from
 * the `@types/node` it carries and no other `@types` — with `@prismshadow/penguin-server/plugin`
 * resolved to the types it wrote into the folder, and a second, virtual root file that assigns the
 * default export to `WorkbenchPackage`. Any diagnostic fails the load, and a workbench that does
 * not load shows nothing. This script builds the same program, with the plugin types a 0.2.19
 * server writes (test/fixtures/harness-0.2.19/plugin.d.ts), and fails on any diagnostic.
 *
 * Then it emits the program, as the host does, into a folder whose `package.json` says
 * `"type": "module"` like the workbench's, imports the emitted entry, and asks the handler for the
 * Benchmarks of an empty data folder: an import the compiler resolved but Node cannot (a file the
 * emit does not carry) fails here rather than in a host.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "workbenches", "benchmark");
const ENTRY = path.join(DIR, "index.ts");
const TYPES_MODULE = "@prismshadow/penguin-server/plugin";
const TYPES_FILE = path.join(ROOT, "test", "fixtures", "harness-0.2.19", "plugin.d.ts");
const CHECK_FILE = path.join(DIR, "__workbench_check__.ts");
const CHECK_SOURCE = `import type { WorkbenchPackage } from ${JSON.stringify(TYPES_MODULE)};
import pkg from "./index.js";
const check: WorkbenchPackage = pkg;
void check;
`;

function fail(message) {
  console.error(`check-workbench: ${message}`);
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-workbench-check-"));
const outDir = path.join(out, "workbench", ".build", "check");
const options = {
  strict: true,
  noEmitOnError: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  skipLibCheck: true,
  typeRoots: [path.join(ROOT, "node_modules", "@types")],
  types: ["node"],
  rootDir: DIR,
  outDir,
};

const same = (file) => path.resolve(file) === CHECK_FILE;
const host = ts.createCompilerHost(options);
const { fileExists, readFile, getSourceFile } = host;
host.fileExists = (file) => same(file) || fileExists.call(host, file);
host.readFile = (file) => (same(file) ? CHECK_SOURCE : readFile.call(host, file));
host.getSourceFile = (file, languageVersion, ...rest) =>
  same(file)
    ? ts.createSourceFile(file, CHECK_SOURCE, languageVersion, true)
    : getSourceFile.call(host, file, languageVersion, ...rest);
const types = {
  resolvedFileName: TYPES_FILE,
  extension: ts.Extension.Dts,
  isExternalLibraryImport: false,
};
host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts, source) =>
  literals.map((literal) =>
    literal.text === TYPES_MODULE
      ? { resolvedModule: types }
      : ts.resolveModuleName(
          literal.text,
          containingFile,
          opts,
          host,
          undefined,
          redirected,
          ts.getModeForUsageLocation(source, literal, opts),
        ),
  );

const program = ts.createProgram([ENTRY, CHECK_FILE], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  const text = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => "\n",
  });
  fail(`the host would refuse the handler:\n${text}`);
}
let emitted = 0;
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile || same(source.fileName)) continue;
  if (program.isSourceFileFromExternalLibrary(source)) continue;
  const result = program.emit(source);
  if (result.emitSkipped) fail(`could not emit ${path.relative(ROOT, source.fileName)}`);
  emitted += 1;
}
// The workbench's own package.json is what makes the emitted files ES modules there, and its
// seeds are what the first load copies into the data folder.
fs.copyFileSync(path.join(DIR, "package.json"), path.join(out, "workbench", "package.json"));
fs.symlinkSync(path.join(DIR, "seeds"), path.join(out, "workbench", "seeds"), "dir");
const seeds = fs
  .readdirSync(path.join(DIR, "seeds"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;

const dataDir = path.join(out, "data");
const { default: pkg } = await import(pathToFileURL(path.join(outDir, "index.js")).href);
const lines = [];
const main = pkg.modules.Workbench.create({
  use: {
    host: {
      dataPaths: () => ({
        dataDir,
        cacheDir: path.join(out, "cache"),
        stateDir: path.join(out, "state"),
      }),
      getState: () => null,
      setState: async () => {},
      log: (line) => lines.push(line),
    },
  },
  effect: () => {},
}).api.main;
const answer = await main.handle({
  method: "GET",
  path: "/benchmarks",
  query: {},
  headers: {},
  body: null,
});
fs.rmSync(out, { recursive: true, force: true });
if (answer.status !== undefined && answer.status !== 200) {
  fail(
    `the emitted handler answered ${answer.status}: ${JSON.stringify(answer.body)} ${lines.join(" | ")}`,
  );
}
const listed = answer.body?.benchmarks;
if (!Array.isArray(listed) || listed.length !== seeds) {
  fail(
    `the emitted handler listed ${listed?.length} Benchmarks of ${seeds} seeds: ${lines.join(" | ")}`,
  );
}
const broken = listed.filter((benchmark) => benchmark.manifestError !== undefined);
if (broken.length > 0)
  fail(`seeds whose manifest does not read: ${broken.map((b) => b.id).join(", ")}`);
console.log(
  `check-workbench: ${emitted} files compile under the host's options; the emitted handler seeds and lists ${listed.length} Benchmarks`,
);
