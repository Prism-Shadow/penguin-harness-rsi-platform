/**
 * The list of the Project's Benchmarks.
 *
 * - Given a Benchmark whose manifest cannot be read, its card is masked like a failed one: Use and
 *   View are disabled, the notice says the manifest cannot be read, the server's reason is behind an
 *   icon, and the owner is told to fix or delete it while a member is told only to fix it.
 * - Given a member, the header offers Import and Create with AI but not Create manually, and no
 *   card offers delete; an owner gets both.
 * - Given `?agentId=` in the location, only the Benchmarks that tested that Agent are listed, and
 *   Show all moves back to the whole list.
 * - Given an admin with machines, this server's Benchmarks are listed the moment it answers while a
 *   machine's answer is still out (a quiet line names that machine), and its copies join when it
 *   lands; a machine that gives no answer is named in one quiet line by label.
 * - Given create and import tasks, the newest few are listed under the cards, a deleted
 *   conversation's task left out.
 * - When the owner deletes a Benchmark and confirms, it is deleted and the list is read again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../../src/ui/strings";
import {
  CONTEXT,
  FakeServer,
  apiError,
  benchmark,
  button,
  card,
  cardButton,
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
  });

  it("tells a member to fix a broken manifest without offering to delete it", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [broken],
      context: { ...CONTEXT, role: "member" },
    }).install();
    await mountApp();
    await waitFor(() => shows(zh.benchmark.manifestBroken), "the masked card");

    expect(card("copied-bench").textContent).toContain(zh.benchmark.manifestBrokenHintMember);
    expect(card("copied-bench").textContent).not.toContain(zh.benchmark.manifestBrokenHint);
    expect(hasButton(zh.benchmark.deleteBenchmark)).toBe(false);
  });

  it("offers a member Import and Create with AI but not Create manually", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      context: { ...CONTEXT, role: "member" },
    }).install();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");

    expect(hasButton(zh.benchmark.importBenchmark)).toBe(true);
    expect(hasButton(zh.form.withAi)).toBe(true);
    expect(hasButton(zh.form.manual)).toBe(false);
    expect(hasButton(zh.benchmark.deleteBenchmark)).toBe(false);
  });

  it("offers the owner Create manually and delete", async () => {
    serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");

    expect(hasButton(zh.form.manual)).toBe(true);
    expect(hasButton(zh.benchmark.deleteBenchmark)).toBe(true);
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

  it("lists this server's Benchmarks without waiting for a machine, whose copies join when it answers", async () => {
    let answerMachine: (response: Response) => void = () => {};
    const machineAnswer = new Promise<Response>((resolve) => {
      answerMachine = resolve;
    });
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      machines: { "m-1": () => machineAnswer },
      context: { ...CONTEXT, isAdmin: true, machines: [{ machineId: "m-1", label: "gpu-box" }] },
    }).install();
    await mountApp();

    await waitFor(() => shows("Sec A"), "this server's list");
    expect(shows(zh.machines.pending("gpu-box"))).toBe(true);
    expect(shows("Machine only")).toBe(false);

    answerMachine(json({ benchmarks: [benchmark({ id: "far", title: "Machine only" })] }));
    await waitFor(() => shows("Machine only"), "the machine's copies");
    expect(shows("Sec A")).toBe(true);
    expect(shows(zh.machines.pending("gpu-box"))).toBe(false);
  });

  it("names the machines that did not answer in one quiet line", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      machines: { "m-1": apiError(502, "machine_unreachable") },
      context: { ...CONTEXT, isAdmin: true, machines: [{ machineId: "m-1", label: "gpu-box" }] },
    }).install();
    await mountApp();
    await waitFor(() => shows(zh.machines.unreachable("gpu-box")), "the quiet line");

    expect(shows("Sec A")).toBe(true);
  });

  it("lists the newest create and import tasks under the cards, leaving out a deleted one", async () => {
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      tasks: [
        task({ sessionId: "s-1", kind: "create", title: "Write report cases", state: "waiting" }),
        task({ sessionId: "s-2", kind: "import", title: "Import Sec E", state: "done" }),
        task({ sessionId: "s-3", kind: "create", title: "Gone task", state: "gone" }),
        task({ sessionId: "s-4", kind: "evaluate", benchmarkId: "sec-a", title: "On a Benchmark" }),
      ],
    }).install();
    await mountApp();
    await waitFor(() => shows("Write report cases"), "the task rows");

    const section = document.querySelector(`ul[aria-label="${zh.tasks.recentTitle}"]`)!;
    expect(section.textContent).toContain(zh.tasks.states.waiting);
    expect(section.textContent).toContain("Import Sec E");
    expect(section.textContent).not.toContain("Gone task");
    expect(section.textContent).not.toContain("On a Benchmark");
  });

  it("deletes a Benchmark once the owner confirms, and reads the list again", async () => {
    const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
    server.on(
      "DELETE",
      "/api/projects/proj/benchmarks/sec-a",
      () => new Response(null, { status: 204 }),
    );
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");
    const reads = server.seen("GET", "/api/projects/proj/benchmarks").length;

    await click(cardButton("Sec A", zh.benchmark.deleteBenchmark));
    expect(shows(zh.benchmark.deleteConfirm("Sec A"))).toBe(true);
    await click(button(zh.common.delete));

    await waitFor(
      () => server.seen("GET", "/api/projects/proj/benchmarks").length > reads,
      "the list read again",
    );
    expect(server.seen("DELETE", "/api/projects/proj/benchmarks/sec-a")).toHaveLength(1);
  });
});
