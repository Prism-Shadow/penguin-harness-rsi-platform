/**
 * The workbench as the host loads it: the Benchmarks in its agent-level data folder, the tasks in
 * its state document, and the seeds copied in before the first request is answered. index.ts
 * hands this its host and its own `seeds/` folder; a suite hands it a fake host and seeds of its
 * own.
 */
import type {
  WorkbenchHost,
  WorkbenchMain,
  WorkbenchRequest,
  WorkbenchResponse,
} from "@prismshadow/penguin-server/plugin";
import { benchmarkRoutes } from "./routes.js";
import { seedOnce } from "./seeds.js";
import { BenchmarkStore } from "./store.js";
import { TaskLog } from "./task-log.js";

export interface WorkbenchOptions {
  /** The folder the first load seeds the data folder from. */
  seedsDir: string;
}

/** The handler of a workbench over `host`, seeding its data folder once (seeds.ts). */
export function createWorkbench(host: WorkbenchHost, options: WorkbenchOptions): WorkbenchMain {
  const { dataDir } = host.dataPaths();
  const log = (line: string) => host.log(line);
  // A seed that fails is said in the log and tried again on the next load; requests are answered
  // either way, after the attempt, so the first list a page reads already holds what landed.
  const seeded = seedOnce(dataDir, options.seedsDir).then(
    (result) => {
      if (result.ran) {
        log(`Seeded ${result.placed.length} Benchmark(s); ${result.kept.length} already here.`);
      }
    },
    (error: unknown) =>
      log(
        `Could not seed the Benchmarks: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );
  const route = benchmarkRoutes({
    store: new BenchmarkStore(dataDir),
    tasks: new TaskLog(host),
    dataDir,
    log,
  });
  return {
    async handle(request: WorkbenchRequest): Promise<WorkbenchResponse> {
      await seeded;
      return route(request);
    },
  };
}
