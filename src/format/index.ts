/**
 * `@penguinharness/rsi-workbench/format`: the on-disk format of a Benchmark, with no host behind
 * it — the manifest `benchmark_config.toml` (types, parse, check, write) and the evaluation
 * records `scoreboard.yaml` (types, parse), plus the dated versions a Benchmark's revisions carry.
 * docs/format.md describes both files. The RSI toolkits write the scoreboard by its contract, and
 * this is the parser that contract is checked against.
 */
export {
  BENCHMARK_MANIFEST,
  BenchmarkManifestError,
  checkBenchmarkManifest,
  parseBenchmarkManifest,
  readBenchmarkManifest,
  serializeBenchmarkManifest,
  writeBenchmarkManifest,
} from "./manifest.js";
export type {
  BenchmarkManifest,
  BenchmarkOrigin,
  BenchmarkOriginKind,
  BenchmarkStatus,
} from "./manifest.js";
export {
  SCOREBOARD_FILE,
  emptyScoreboard,
  parseEvaluation,
  parseScoreboard,
} from "./scoreboard.js";
export type { BenchmarkCaseScore, BenchmarkEvaluation, BenchmarkRunScore } from "./scoreboard.js";
export {
  DATE_VERSION_PATTERN,
  compareDateVersions,
  formatLocalDate,
  nextDateVersion,
  parseDateVersion,
} from "./dates.js";
export { isValidId } from "./ids.js";
