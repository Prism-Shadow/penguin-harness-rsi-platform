/**
 * One Benchmark's page.
 *
 * - It names the directory the files live in and the version the manifest is at; a copy an Agent
 *   imported from a repository folder links that folder, and a source that is not http(s) is never
 *   rendered as a link.
 * - A published Benchmark offers Export, a download of its package from the server holding the
 *   copy — through the host's machine proxy for a copy only a machine holds; a draft offers none.
 * - A Benchmark whose manifest cannot be read shows the notice with the reason in place of the
 *   detail; an id the list does not hold says it was not found.
 * - A case's files are read from the server its listing names: a machine's through the proxy.
 * - In an evaluation, a run in a Session opens that conversation through the host once the Session
 *   is confirmed to exist, and says so when it is gone; a run recorded as a Harbor trial offers the
 *   trial's name to copy instead of a link.
 * - The tasks started on the Benchmark are listed with their state, and Open chat takes the viewer
 *   to the conversation through the host.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MergedBenchmark } from "../../src/api";
import { zh } from "../../src/ui/strings";
import {
  CONTEXT,
  FakeServer,
  apiError,
  benchmark,
  button,
  click,
  evaluation,
  fakeHost,
  hasButton,
  json,
  lastPosted,
  mountApp,
  serveProject,
  shows,
  task,
  unmountAll,
  waitFor,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FOLDER =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/c12d65bc20beb5130ed57b3b7983c62d497b7d2f/packages/penguinharness-benchmark-sec-a";

async function openPage(subject: MergedBenchmark, extra: (server: FakeServer) => void = () => {}) {
  const server = serveProject(new FakeServer(), {
    benchmarks: [subject],
    context: { ...CONTEXT, isAdmin: true, machines: [{ machineId: "m-1", label: "gpu-box" }] },
  });
  server.on("GET", `/api/projects/proj/benchmarks/${subject.id}/cases`, { cases: [] });
  server.on("GET", `/api/projects/proj/benchmarks/tasks`, { tasks: [] });
  extra(server);
  server.install();
  const host = fakeHost();
  await mountApp({ at: `/${subject.id}` });
  await waitFor(() => hasButton(zh.benchmark.backToList), "the Benchmark's page");
  return { server, host };
}

const links = () => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

describe("a Benchmark's page", () => {
  it("names the directory and the version, and links the folder an Agent imported it from", async () => {
    await openPage(
      benchmark({ version: "2026.10.09.2", origin: { kind: "git", url: FOLDER, ref: "c12d65bc" } }),
    );

    expect(shows("agents/system_agent/app/data/benchmark/sec-a")).toBe(true);
    expect(shows("v2026.10.09.2")).toBe(true);
    expect(links()).toContain(FOLDER);
  });

  it("never renders a source that is not an http(s) link as one", async () => {
    await openPage(benchmark({ origin: { kind: "git", url: "javascript:alert(1)" } }));

    expect(links().some((href) => href?.startsWith("javascript:"))).toBe(false);
  });

  it("offers Export from this server for a published copy", async () => {
    await openPage(benchmark());

    const exportLink = button(zh.benchmark.exportBenchmark);
    expect(exportLink.getAttribute("href")).toBe("/api/projects/proj/benchmarks/sec-a/archive");
    expect(exportLink.hasAttribute("download")).toBe(true);
  });

  it("exports a copy only a machine holds through the host's machine proxy", async () => {
    await openPage(benchmark({ machineIds: ["m-1"] }));

    expect(button(zh.benchmark.exportBenchmark).getAttribute("href")).toBe(
      "/server/m-1/api/projects/proj/benchmarks/sec-a/archive",
    );
    expect(shows(zh.machines.onMachine("Sec A", "gpu-box"))).toBe(true);
  });

  it("offers no Export and no Use for a draft", async () => {
    await openPage(benchmark({ status: "draft" }));

    expect(hasButton(zh.benchmark.exportBenchmark)).toBe(false);
    expect(hasButton(zh.benchmark.use)).toBe(false);
    expect(shows(zh.benchmark.building)).toBe(true);
  });

  it("shows why a manifest cannot be read in place of the detail", async () => {
    const reason = "benchmark_config.toml: missing title";
    await openPage(
      benchmark({
        status: "failed",
        manifestError: { code: "benchmark_manifest_invalid", message: reason },
      }),
    );

    expect(shows(zh.benchmark.manifestBroken)).toBe(true);
    expect(shows(reason)).toBe(true);
    expect(shows(zh.benchmark.creationFailed)).toBe(false);
  });

  it("says a Benchmark the list does not hold was not found", async () => {
    serveProject(new FakeServer(), { benchmarks: [] }).install();
    await mountApp({ at: "/gone-bench" });

    await waitFor(() => shows(zh.benchmark.notFound), "the not-found notice");
  });

  it("reads a case's files from the machine that listed it, through the proxy", async () => {
    const { server } = await openPage(benchmark({ machineIds: [null, "m-1"] }), (s) => {
      s.on("GET", "/api/projects/proj/benchmarks/sec-a/cases", {
        cases: [{ id: "CASE-001-report", title: "Conflicting sources", machineId: "m-1" }],
      });
      s.on("GET", "/server/m-1/api/projects/proj/benchmarks/sec-a/cases/CASE-001-report/files", {
        path: "",
        entries: [],
      });
      s.on(
        "GET",
        "/server/m-1/api/projects/proj/benchmarks/sec-a/cases/CASE-001-report/rubric/files",
        { path: "", entries: [] },
      );
    });
    await waitFor(() => shows("Conflicting sources"), "the case list");

    await click(button(`Conflicting sources${zh.benchmark.viewCase}`));

    await waitFor(
      () =>
        server.seen(
          "GET",
          "/server/m-1/api/projects/proj/benchmarks/sec-a/cases/CASE-001-report/files",
        ).length > 0,
      "the statement listing from the machine",
    );
    expect(
      server.seen(
        "GET",
        "/server/m-1/api/projects/proj/benchmarks/sec-a/cases/CASE-001-report/rubric/files",
      ),
    ).toHaveLength(1);
  });

  it("opens a run's conversation through the host once its Session is confirmed", async () => {
    const scored = evaluation({
      cases: [
        {
          case: "CASE-001-report",
          score: 70,
          cost: null,
          durationMs: 1000,
          runs: [
            { score: 70, cost: null, durationMs: 1000, sessionId: "session-run-1" },
            { score: 60, cost: null, durationMs: 900, sessionId: "harbor:music-harmony__AbC1234" },
          ],
        },
      ],
    });
    const { host } = await openPage(benchmark({ evaluations: [scored] }), (s) => {
      s.on("GET", "/api/sessions/session-run-1", json({ session: { sessionId: "session-run-1" } }));
    });

    await click(button(dateButton()));
    await click(
      [...document.querySelectorAll("tr")].find((tr) =>
        tr.textContent?.includes("CASE-001-report"),
      )!,
    );

    expect(hasButton(zh.benchmark.copyTrialName)).toBe(true);
    await click(button(`${zh.benchmark.colRun} #1`));

    await waitFor(() => lastPosted(host, "penguin:navigate") !== undefined, "the navigate message");
    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: "/chat/session-run-1",
    });
  });

  it("says so when a run's Session no longer exists", async () => {
    const scored = evaluation({
      cases: [
        {
          case: "CASE-001-report",
          score: 70,
          cost: null,
          durationMs: 1000,
          runs: [{ score: 70, cost: null, durationMs: 1000, sessionId: "session-gone" }],
        },
      ],
    });
    const { host } = await openPage(benchmark({ evaluations: [scored] }), (s) => {
      s.on("GET", "/api/sessions/session-gone", apiError(404, "session_not_found"));
    });

    await click(button(dateButton()));
    await click(
      [...document.querySelectorAll("tr")].find((tr) =>
        tr.textContent?.includes("CASE-001-report"),
      )!,
    );
    await click(button(`${zh.benchmark.colRun} #1`));

    await waitFor(() => shows(zh.benchmark.runSessionGone), "the gone line");
    expect(lastPosted(host, "penguin:navigate")).toBeUndefined();
  });

  it("lists the tasks started on it and opens a task's conversation through the host", async () => {
    const { host } = await openPage(benchmark(), (s) => {
      s.on("GET", "/api/projects/proj/benchmarks/tasks", (request) =>
        json({
          tasks:
            request.query.get("benchmarkId") === "sec-a"
              ? [
                  task({
                    sessionId: "s-eval",
                    title: "Evaluate the ticket agent",
                    benchmarkId: "sec-a",
                  }),
                ]
              : [],
        }),
      );
    });
    await waitFor(() => shows("Evaluate the ticket agent"), "the task row");

    expect(shows(zh.tasks.states.running)).toBe(true);
    await click(button(zh.tasks.openChat));

    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: "/chat/s-eval",
    });
  });
});

/** The time button that opens the only evaluation row. */
function dateButton(): string {
  const cell = document.querySelector("tbody tr td button");
  if (cell === null) throw new Error("no evaluation row");
  return cell.textContent ?? "";
}
