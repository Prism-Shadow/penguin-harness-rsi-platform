/**
 * Importing a Benchmark package from a zip.
 *
 * - Given an upload whose id is taken, the answer is the overwrite question about the id the
 *   server's details name (the picked file's name when they name none); confirming sends the same
 *   zip again with `overwrite`, and the Benchmark comes back as imported.
 * - Given an overwrite refused while the Benchmark is being evaluated, or a zip the server refuses,
 *   the reason comes back to be shown, not the question again.
 * - In the dialog, the overwrite confirm names the id, and confirming it imports and reads the list
 *   again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkSummary } from "../../src/api";
import { projectApi } from "../../src/ui/api";
import { uploadBenchmarkArchive } from "../../src/ui/pages/import-dialog";
import { zh } from "../../src/ui/strings";
import {
  FakeServer,
  apiError,
  benchmark,
  button,
  click,
  fakeHost,
  json,
  mountApp,
  serveProject,
  settle,
  shows,
  unmountAll,
  waitFor,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ZIP = btoa("PK zip bytes");
const ARCHIVE = "/api/projects/proj/benchmarks/archive";

const IMPORTED: BenchmarkSummary = {
  id: "report-writing-v1",
  title: "Report writing under conflicting sources",
  status: "published",
  runs: 2,
  version: "2026.10.08.3",
  origin: { kind: "zip", importedAt: "2026-10-09T08:00:00.000Z" },
  caseCount: 2,
  evaluations: [],
  agentIds: [],
};

const upload = (overwrite: boolean) =>
  uploadBenchmarkArchive(projectApi("proj"), ZIP, { overwrite, fallbackId: "picked-file" }, zh);

describe("a zip upload", () => {
  it("whose id is taken asks about the id the answer names, and the confirmed overwrite resends the zip", async () => {
    const server = new FakeServer()
      .on("POST", ARCHIVE, () =>
        apiError(409, "benchmark_exists", "taken", { benchmarkId: "report-writing-v1" }),
      )
      .install();

    expect(await upload(false)).toEqual({ kind: "exists", benchmarkId: "report-writing-v1" });
    expect(server.seen("POST", ARCHIVE)[0]!.body).toEqual({ dataBase64: ZIP });

    server.on("POST", ARCHIVE, () => json({ benchmark: IMPORTED }, 201));
    expect(await upload(true)).toEqual({ kind: "imported", benchmark: IMPORTED });
    expect(server.seen("POST", ARCHIVE)[1]!.body).toEqual({ dataBase64: ZIP, overwrite: true });
  });

  it("whose id is taken, by an answer that names none, asks about the picked file's own name", async () => {
    new FakeServer().on("POST", ARCHIVE, () => apiError(409, "benchmark_exists")).install();

    expect(await upload(false)).toEqual({ kind: "exists", benchmarkId: "picked-file" });
  });

  it("refused while the Benchmark is being evaluated comes back with that reason", async () => {
    new FakeServer()
      .on("POST", ARCHIVE, () => apiError(409, "benchmark_busy", "Benchmark is being evaluated."))
      .install();

    expect(await upload(true)).toEqual({ kind: "refused", text: zh.errors.byCode.benchmark_busy });
  });

  it("that the server refuses comes back with its reason", async () => {
    new FakeServer()
      .on("POST", ARCHIVE, () =>
        apiError(400, "benchmark_case_invalid", "CASE-002-format has no rubric/README.md."),
      )
      .install();

    expect(await upload(false)).toEqual({
      kind: "refused",
      text: "CASE-002-format has no rubric/README.md.",
    });
  });
});

describe("the import dialog", () => {
  it("asks before overwriting a taken id, then imports and reads the list again", async () => {
    const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
    let answered = false;
    server.on("POST", ARCHIVE, () => {
      if (answered) return json({ benchmark: IMPORTED }, 201);
      answered = true;
      return apiError(409, "benchmark_exists", "taken", { benchmarkId: "report-writing-v1" });
    });
    fakeHost();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");
    const reads = server.seen("GET", "/api/projects/proj/benchmarks").length;

    await click(button(zh.benchmark.importBenchmark));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["PK zip bytes"], "report-writing-v1-v2026.10.08.3.zip", {
      type: "application/zip",
    });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(
      () => shows(zh.benchmark.importOverwriteBody("report-writing-v1")),
      "the question",
    );
    await click(button(zh.benchmark.importOverwriteAction));

    await waitFor(
      () => server.seen("GET", "/api/projects/proj/benchmarks").length > reads,
      "the list read again",
    );
    await settle();
    expect(server.seen("POST", ARCHIVE)[1]!.body).toMatchObject({ overwrite: true });
    expect(shows(zh.benchmark.importChatTitle)).toBe(false);
  });
});
