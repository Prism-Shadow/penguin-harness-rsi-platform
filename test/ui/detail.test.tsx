/**
 * One Benchmark's page.
 *
 * - It names the directory the files live in — the folder the server gave, relative to the
 *   Project's folder when inside it — and the version the manifest is at; a copy an Agent imported
 *   from a repository folder links that folder, and a source that is not http(s) is never rendered
 *   as a link.
 * - A published Benchmark offers Export, a download of its package from the server holding the
 *   copy: this workbench's handler, a machine's workbench through the host's machine proxy, or the
 *   older Project route of a machine still on 0.2.19; a draft offers none.
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
import { benchmarkFolderLabel } from "../../src/ui/pages/detail-page";
import { zh } from "../../src/ui/strings";
import {
  BENCHMARKS,
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
  machineBenchmarks,
  mountApp,
  record,
  serveProject,
  session,
  shows,
  unmountAll,
  waitFor,
  type MachineFixture,
  type ProjectFixture,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FOLDER =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/c12d65bc20beb5130ed57b3b7983c62d497b7d2f/packages/penguinharness-benchmark-sec-a";

/** Machine m-1, upgraded: its App Center lists this Agent's rsi-workbench. */
const GPU_BOX: MachineFixture = { label: "gpu-box", workbench: "benchmark" };
const M1 = machineBenchmarks("m-1", GPU_BOX);

/**
 * Opens `subject`'s page as an admin, its copy held by `copies` (null: this server; "m-1": the
 * machine `machine`), once its title is shown.
 */
async function openPage(
  subject: MergedBenchmark,
  {
    extra = () => {},
    copies = [null],
    machine = GPU_BOX,
    project = {},
  }: {
    extra?: (server: FakeServer) => void;
    copies?: (string | null)[];
    machine?: MachineFixture;
    project?: Pick<ProjectFixture, "tasks" | "sessions">;
  } = {},
) {
  const server = serveProject(new FakeServer(), {
    ...project,
    isAdmin: true,
    benchmarks: copies.includes(null) ? [subject] : [],
    machines: { "m-1": { ...machine, benchmarks: copies.includes("m-1") ? [subject] : [] } },
  });
  extra(server);
  server.install();
  const host = fakeHost();
  await mountApp({ at: `/${subject.id}` });
  await waitFor(
    () => (document.querySelector("h1")?.textContent ?? "").includes(subject.title),
    "the Benchmark's page",
  );
  return { server, host };
}

const links = () => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

describe("a Benchmark's page", () => {
  it("names the directory and the version, and links the folder an Agent imported it from", async () => {
    await openPage(
      benchmark({
        dir: "/srv/penguin/proj/agents/default_agent/app/data/benchmark/sec-a",
        version: "2026.10.09.2",
        origin: { kind: "git", url: FOLDER, ref: "c12d65bc" },
      }),
    );

    await waitFor(() => shows("v2026.10.09.2"), "the version");
    expect(shows("agents/default_agent/app/data/benchmark/sec-a")).toBe(true);
    expect(shows("/srv/penguin")).toBe(false);
    expect(links()).toContain(FOLDER);
  });

  it("never renders a source that is not an http(s) link as one", async () => {
    await openPage(benchmark({ origin: { kind: "git", url: "javascript:alert(1)" } }));

    expect(links().some((href) => href?.startsWith("javascript:"))).toBe(false);
  });

  it("offers Export from this workbench for a published copy", async () => {
    await openPage(benchmark());

    await waitFor(() => hasButton(zh.benchmark.exportBenchmark), "the Export link");
    const exportLink = button(zh.benchmark.exportBenchmark);
    expect(exportLink.getAttribute("href")).toBe(`${BENCHMARKS}/sec-a/archive`);
    expect(exportLink.hasAttribute("download")).toBe(true);
  });

  it("exports a copy only a machine holds from that machine's workbench, through the proxy", async () => {
    await openPage(benchmark(), { copies: ["m-1"] });

    await waitFor(() => hasButton(zh.benchmark.exportBenchmark), "the Export link");
    expect(button(zh.benchmark.exportBenchmark).getAttribute("href")).toBe(`${M1}/sec-a/archive`);
    expect(shows(zh.machines.onMachine("Sec A", "gpu-box"))).toBe(true);
  });

  it("exports a copy a machine still on 0.2.19 holds from its older Project route", async () => {
    await openPage(benchmark(), { copies: ["m-1"], machine: { label: "old-box" } });

    await waitFor(() => hasButton(zh.benchmark.exportBenchmark), "the Export link");
    expect(button(zh.benchmark.exportBenchmark).getAttribute("href")).toBe(
      "/server/m-1/api/projects/proj/benchmarks/sec-a/archive",
    );
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

  it("requests case pages as the reader navigates", async () => {
    const path = `${BENCHMARKS}/sec-a/cases`;
    const { server } = await openPage(benchmark({ caseCount: 7 }), {
      extra: (s) => {
        s.on("GET", path, ({ query }) => {
          const ids = query.get("page") === "1" ? [1, 2, 3, 4, 5] : [6, 7];
          return json({
            total: 7,
            cases: ids.map((i) => ({ id: `CASE-${i}`, title: `Question ${i}` })),
          });
        });
      },
    });
    const pages = () => server.seen("GET", path).map((request) => request.query.get("page"));
    await waitFor(() => shows("Question 5"));
    expect(pages()).toEqual(["1"]);
    expect(shows("Question 6")).toBe(false);
    await click(button(zh.ui.next));
    await waitFor(() => shows("Question 7"));
    expect(shows("Question 5")).toBe(false);
    await click(button(zh.ui.previous));
    await waitFor(() => shows("Question 1"));
    expect(pages()).toEqual(["1", "2", "1"]);
  });

  it("reads a case's files from the machine that listed it, through the proxy", async () => {
    const files = `${M1}/sec-a/cases/CASE-001-report`;
    const { server } = await openPage(benchmark(), {
      copies: [null, "m-1"],
      extra: (s) => {
        s.on("GET", `${M1}/sec-a/cases`, {
          cases: [{ id: "CASE-001-report", title: "Conflicting sources" }],
        });
        s.on("GET", `${files}/files`, { path: "", entries: [] });
        s.on("GET", `${files}/rubric/files`, { path: "", entries: [] });
      },
    });
    await waitFor(() => shows("Conflicting sources"), "the case list");

    await click(button(`Conflicting sources${zh.benchmark.viewCase}`));

    await waitFor(
      () => server.seen("GET", `${files}/files`).length > 0,
      "the statement listing from the machine",
    );
    expect(server.seen("GET", `${files}/rubric/files`)).toHaveLength(1);
    expect(server.requests.some((r) => r.path.startsWith(`${BENCHMARKS}/sec-a/cases/`))).toBe(
      false,
    );
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
    const { host } = await openPage(benchmark({ evaluations: [scored] }), {
      project: { sessions: { "session-run-1": session({ sessionId: "session-run-1" }) } },
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
    const { host } = await openPage(benchmark({ evaluations: [scored] }), {
      project: { sessions: { "session-gone": apiError(404, "session_not_found") } },
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
    const { host } = await openPage(benchmark(), {
      project: {
        tasks: [
          record({ sessionId: "s-eval", benchmarkId: "sec-a" }),
          record({ sessionId: "s-other", benchmarkId: "sec-b" }),
        ],
        sessions: {
          "s-eval": session({ sessionId: "s-eval", title: "Evaluate the ticket agent" }),
          "s-other": session({ sessionId: "s-other", title: "Another Benchmark's task" }),
        },
      },
    });
    await waitFor(() => shows("Evaluate the ticket agent"), "the task row");

    expect(shows("Another Benchmark's task")).toBe(false);
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

describe("the folder label", () => {
  it("is the folder relative to the Project's, wherever the host keeps the Benchmarks", () => {
    const label = (dir: string | undefined) => benchmarkFolderLabel(dir, "proj", "sec-a");
    expect(label("/data/proj/benchmarks/sec-a")).toBe("benchmarks/sec-a");
    expect(
      label("/home/proj/data/projects/proj/agents/system_agent/app/data/benchmark/sec-a"),
    ).toBe("agents/system_agent/app/data/benchmark/sec-a");
    expect(label("C:\\Users\\me\\data\\proj\\benchmarks\\sec-a")).toBe("benchmarks\\sec-a");
    expect(label("/elsewhere/sec-a")).toBe("/elsewhere/sec-a");
    expect(label(undefined)).toBe("benchmarks/sec-a");
  });
});
