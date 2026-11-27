/**
 * The list of the workbench's Benchmarks.
 *
 * - Given a Benchmark whose manifest cannot be read, its card is masked like a failed one: Use and
 *   View are disabled, the notice says the manifest cannot be read, the server's reason is behind an
 *   icon, and the hint says it can be fixed or deleted.
 * - Given any viewer, the header offers Import, Create with AI and Create manually, and every card
 *   of this server's copy offers delete; a copy only a machine holds offers none.
 * - Given `?agentId=` in the location, only the Benchmarks that tested that Agent are listed, and
 *   Show all moves back to the whole list.
 * - Given an admin, each machine the Project uses with Penguin installed is read: one whose App
 *   Center lists this Agent's rsi-workbench at that workbench's handler, one without at its older
 *   Project route (`?local=1`); copies of one id merge into one card. This server's Benchmarks are
 *   listed the moment it answers while a machine's answer is still out (a quiet line names that
 *   machine), and a machine that gives no answer is named in one quiet line by label. A viewer who
 *   is not an admin asks no machine.
 * - Given create and import tasks, the newest few are listed under the cards, one whose
 *   conversation the viewer cannot read left out.
 * - When the viewer deletes a Benchmark and confirms, it is deleted and the list is read again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../../src/ui/strings";
import {
  BENCHMARKS,
  FakeServer,
  PROJECT,
  apiError,
  benchmark,
  button,
  card,
  cardButton,
  cardHasButton,
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
  taskRows,
  unmountAll,
  waitFor,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REASON =
  'benchmark_config.toml: "id" is "report-writing-v1", but the directory is "copied-bench".';

const broken = benchmark({
  id: "copied-bench",
  title: "copied-bench",
  status: "failed",
  manifestError: { code: "benchmark_id_mismatch", message: REASON },
});

const hints = (el: Element) =>
  [...el.querySelectorAll("[data-tooltip]")].map((node) => node.getAttribute("data-tooltip"));

const cardsTitled = (title: string) =>
  [...document.querySelectorAll(`ul[aria-label="${zh.appTitle}"] > li`)].filter((li) =>
    li.textContent?.includes(title),
  );

describe("the list of Benchmarks", () => {
  it("masks a Benchmark whose manifest cannot be read, with the reason behind an icon", async () => {
    serveProject(new FakeServer(), { benchmarks: [broken] }).install();
    await mountApp();
    await waitFor(() => shows(zh.benchmark.manifestBroken), "the masked card");

    const masked = card("copied-bench");
    expect(cardButton("copied-bench", zh.benchmark.use).disabled).toBe(true);
    expect(cardButton("copied-bench", zh.benchmark.view).disabled).toBe(true);
    expect(masked.textContent).not.toContain(zh.benchmark.creationFailed);
    expect(hints(masked)).toContain(REASON);
    expect(masked.textContent).toContain(zh.benchmark.manifestBrokenHint);
    expect(cardHasButton("copied-bench", zh.benchmark.deleteBenchmark)).toBe(true);
  });

  it("offers any viewer Import, both ways to create, and delete on this server's copies", async () => {
    serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");

    expect(hasButton(zh.benchmark.importBenchmark)).toBe(true);
    expect(hasButton(zh.form.withAi)).toBe(true);
    expect(hasButton(zh.form.manual)).toBe(true);
    expect(cardHasButton("Sec A", zh.benchmark.deleteBenchmark)).toBe(true);
  });

  it("narrows to the Benchmarks that tested the Agent the location names, and Show all widens it", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [
        benchmark({
          id: "tested",
          title: "Tested one",
          evaluations: [evaluation({ agentId: "ticket-agent" })],
        }),
        benchmark({ id: "untested", title: "Untested one" }),
      ],
    }).install();
    const host = fakeHost();
    await mountApp({ at: "/?agentId=ticket-agent" });
    await waitFor(() => shows("Tested one"), "the filtered list");

    expect(shows("Untested one")).toBe(false);
    expect(shows(zh.benchmark.filterByAgent("ticket-agent"))).toBe(true);

    await click(button(zh.benchmark.clearFilter));

    await waitFor(() => shows("Untested one"), "the whole list");
    expect(lastPosted(host, "penguin:location")).toEqual({ type: "penguin:location", at: "/" });
  });

  it("deletes a Benchmark once the viewer confirms, and reads the list again", async () => {
    const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
    server.on("DELETE", `${BENCHMARKS}/sec-a`, () => new Response(null, { status: 204 }));
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");
    const reads = server.seen("GET", BENCHMARKS).length;

    await click(cardButton("Sec A", zh.benchmark.deleteBenchmark));
    expect(shows(zh.benchmark.deleteConfirm("Sec A"))).toBe(true);
    await click(button(zh.common.delete));

    await waitFor(() => server.seen("GET", BENCHMARKS).length > reads, "the list read again");
    expect(server.seen("DELETE", `${BENCHMARKS}/sec-a`)).toHaveLength(1);
  });
});

describe("the machines' copies", () => {
  const upgraded = { label: "gpu-box", workbench: "benchmark" };
  const older = { label: "old-box" };

  it("reads each machine where it keeps them and merges the copies by id", async () => {
    const server = serveProject(new FakeServer(), {
      isAdmin: true,
      benchmarks: [benchmark()],
      machines: {
        "m-new": {
          ...upgraded,
          benchmarks: [
            benchmark({ evaluations: [evaluation({ agentId: "default_agent" })] }),
            benchmark({ id: "far-new", title: "On the new machine" }),
          ],
        },
        "m-old": {
          ...older,
          benchmarks: [benchmark({ id: "far-old", title: "On the old machine" })],
        },
      },
    }).install();
    await mountApp();

    await waitFor(
      () => shows("On the new machine") && shows("On the old machine"),
      "both machines' copies",
    );
    expect(cardsTitled("Sec A")).toHaveLength(1);
    expect(server.seen("GET", machineBenchmarks("m-new", upgraded))).toHaveLength(1);
    const legacy = server.seen("GET", machineBenchmarks("m-old", older));
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.query.get("local")).toBe("1");
    expect(server.seen("GET", machineBenchmarks("m-new", {}))).toHaveLength(0);
    expect(cardHasButton("On the new machine", zh.benchmark.deleteBenchmark)).toBe(false);
    expect(cardHasButton("Sec A", zh.benchmark.deleteBenchmark)).toBe(true);
  });

  it("asks only the machines the Project uses with Penguin installed", async () => {
    const server = serveProject(new FakeServer(), {
      isAdmin: true,
      benchmarks: [benchmark()],
      machines: {
        "m-1": { ...upgraded, benchmarks: [benchmark({ id: "far", title: "Machine only" })] },
        "m-lent": { label: "not ours", member: false },
        "m-bare": { label: "no penguin", installed: false },
      },
    }).install();
    await mountApp();
    await waitFor(() => shows("Machine only"), "the machine's copies");

    const asked = new Set(
      server.requests
        .map((r) => /^\/server\/([^/]+)\//.exec(r.path)?.[1])
        .filter((m): m is string => m !== undefined),
    );
    expect([...asked]).toEqual(["m-1"]);
  });

  it("asks no machine for a viewer who is not an admin", async () => {
    const server = serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      machines: { "m-1": { ...upgraded, benchmarks: [benchmark({ id: "far" })] } },
    }).install();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");

    expect(server.seen("GET", `${PROJECT}/machines`)).toHaveLength(0);
    expect(server.requests.filter((r) => r.path.startsWith("/server/"))).toEqual([]);
  });

  it("lists this server's Benchmarks without waiting for a machine, whose copies join when it answers", async () => {
    let answerMachine: (response: Response) => void = () => {};
    const machineAnswer = new Promise<Response>((resolve) => {
      answerMachine = resolve;
    });
    serveProject(new FakeServer(), {
      isAdmin: true,
      benchmarks: [benchmark()],
      machines: { "m-1": { ...upgraded, benchmarks: () => machineAnswer } },
    }).install();
    await mountApp();

    await waitFor(() => shows("Sec A"), "this server's list");
    await waitFor(() => shows(zh.machines.pending("gpu-box")), "the pending line");
    expect(shows("Machine only")).toBe(false);

    answerMachine(json({ benchmarks: [benchmark({ id: "far", title: "Machine only" })] }));
    await waitFor(() => shows("Machine only"), "the machine's copies");
    expect(shows("Sec A")).toBe(true);
    expect(shows(zh.machines.pending("gpu-box"))).toBe(false);
  });

  it("names the machines that did not answer in one quiet line", async () => {
    serveProject(new FakeServer(), {
      isAdmin: true,
      benchmarks: [benchmark()],
      machines: { "m-1": { ...older, benchmarks: apiError(502, "machine_unreachable") } },
    }).install();
    await mountApp();
    await waitFor(() => shows(zh.machines.unreachable("old-box")), "the quiet line");

    expect(shows("Sec A")).toBe(true);
  });
});

describe("the create and import tasks", () => {
  it("lists the newest under the cards, leaving out one whose conversation cannot be read", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      tasks: [
        record({ sessionId: "s-1", kind: "create" }),
        record({ sessionId: "s-2", kind: "import" }),
        record({ sessionId: "s-3", kind: "create" }),
        record({ sessionId: "s-4", kind: "evaluate", benchmarkId: "sec-a" }),
      ],
      sessions: {
        "s-1": session({ sessionId: "s-1", title: "Write report cases", pendingApprovalCount: 2 }),
        "s-2": session({ sessionId: "s-2", title: "Import Sec E", status: "idle" }),
        "s-3": apiError(404, "session_not_found"),
        "s-4": session({ sessionId: "s-4", title: "On a Benchmark" }),
      },
    }).install();
    await mountApp();
    await waitFor(() => shows("Write report cases"), "the task rows");

    const rows = taskRows(zh.tasks.recentTitle);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(zh.tasks.states.waiting);
    expect(rows[1]!.textContent).toContain("Import Sec E");
    expect(rows[1]!.textContent).toContain(zh.tasks.states.done);
    expect(shows("On a Benchmark")).toBe(false);
  });
});
