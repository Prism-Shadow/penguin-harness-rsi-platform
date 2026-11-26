/**
 * Placing a Benchmark under its id (workbenches/benchmark/lib/place.ts): what the zip import and
 * the first load's seeds write through.
 *
 * Given a workbench's data folder in a temp folder:
 * - When another writer's copy gets under the id while this one is still being written, the
 *   placement fails with EEXIST on every platform; the other copy stays as it is, and nothing is
 *   left in staging.
 * - When a placement replaces the id, it takes the id's directory whole, and leaves nothing in
 *   staging either.
 * - When overwrites of one id are sent at once, they never write together: the last one asked for
 *   holds the id, whole, and no moved-aside copy is left behind in staging.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placeBenchmark } from "../../workbenches/benchmark/lib/place.js";
import { tempRoot } from "../helpers/workbench.js";

const ID = "report-writing-v1";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await tempRoot("rsi-place-");
  dir = path.join(root, "benchmark");
  await fs.mkdir(dir);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writePackage(benchDir: string, manifest: string): Promise<void> {
  await fs.writeFile(path.join(benchDir, "benchmark_config.toml"), manifest);
  await fs.mkdir(path.join(benchDir, "CASE-001", "statement"), { recursive: true });
  await fs.writeFile(path.join(benchDir, "CASE-001", "statement", "README.md"), "# A case\n");
}

describe("placing a Benchmark", () => {
  it("fails with EEXIST when another writer's copy takes the id first, and leaves that copy", async () => {
    const placing = placeBenchmark(dir, ID, async (stage) => {
      await writePackage(stage, "ours\n");
      // Another import of the same id lands while this copy is still being written.
      await fs.mkdir(path.join(dir, ID));
      await writePackage(path.join(dir, ID), "theirs\n");
    });

    await expect(placing).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(path.join(dir, ID, "benchmark_config.toml"), "utf8")).toBe("theirs\n");
    expect(await fs.readdir(dir)).toEqual([ID]);
  });

  it("with replace, takes the id's directory whole", async () => {
    await fs.mkdir(path.join(dir, ID, ".jobs"), { recursive: true });
    await writePackage(path.join(dir, ID), "old\n");
    await fs.writeFile(path.join(dir, ID, "scoreboard.yaml"), "evaluations: []\n");

    await placeBenchmark(dir, ID, (stage) => writePackage(stage, "new\n"), { replace: true });

    expect(await fs.readFile(path.join(dir, ID, "benchmark_config.toml"), "utf8")).toBe("new\n");
    expect((await fs.readdir(path.join(dir, ID))).sort()).toEqual([
      "CASE-001",
      "benchmark_config.toml",
    ]);
    expect(await fs.readdir(dir)).toEqual([ID]);
  });

  it("runs overwrites of one id sent at once one after another, and the last one asked for holds the id", async () => {
    await placeBenchmark(dir, ID, (stage) => writePackage(stage, "v0\n"));
    let writing = 0;
    let together = 0;
    const overwrite = (n: number) =>
      placeBenchmark(
        dir,
        ID,
        async (stage) => {
          writing += 1;
          together = Math.max(together, writing);
          // Hand the event loop over mid-write, where an overlapping placement would start its own.
          await new Promise((resolve) => setImmediate(resolve));
          await writePackage(stage, `v${n}\n`);
          writing -= 1;
        },
        { replace: true },
      );

    await Promise.all([1, 2, 3, 4].map(overwrite));

    expect(together).toBe(1);
    expect(await fs.readFile(path.join(dir, ID, "benchmark_config.toml"), "utf8")).toBe("v4\n");
    expect(await fs.readdir(dir)).toEqual([ID]);
  });
});
