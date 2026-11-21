/**
 * Starting an Agent task from a form, and the tasks the page lists.
 *
 * - When the person fills Create with AI and presses Start, the form is posted to `…/tasks` with
 *   approval mode allow-all and the page's language, the form closes, and a confirmation offers
 *   Open chat, which asks the host to open the new conversation.
 * - Given another approval mode picked in the form, that mode goes with the request.
 * - The form's full prompt is the server's preview of the request (`?preview=1`), shown read-only.
 * - When the Agent lacks the Skill the task needs (409 `skill_missing`), the form stays open with
 *   a notice naming the plugin and Install; installing it posts to the host's install route for that
 *   Agent, and Start then goes through.
 * - A Benchmark's task list is read every five seconds while the document is visible, not at all
 *   while it is hidden, and at once when it shows again; nor while the frame is hidden (a minimized
 *   App Center window), and again once it is shown.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../../src/ui/strings";
import {
  FakeServer,
  apiError,
  benchmark,
  button,
  click,
  fakeHost,
  json,
  lastPosted,
  mountApp,
  pick,
  promptBox,
  serveProject,
  shows,
  task,
  type,
  unmountAll,
  waitFor,
  type SeenRequest,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TASKS = "/api/projects/proj/benchmarks/tasks";
const starts = (server: FakeServer) =>
  server.seen("POST", TASKS).filter((r) => r.query.get("preview") !== "1");

async function openCreateForm() {
  const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] }).install();
  const host = fakeHost();
  await mountApp();
  await waitFor(() => shows("Sec A"), "the list");
  await click(button(zh.form.withAi));
  await type(promptBox(zh.form.promptLabel), "Cases on conflicting sources");
  return { server, host };
}

describe("starting a task", () => {
  it("posts the form with allow-all and the page's language, then confirms with a way into the conversation", async () => {
    const { server, host } = await openCreateForm();

    await click(button(zh.form.start));

    await waitFor(() => shows(zh.tasks.started(zh.tasks.kinds.create)), "the confirmation");
    expect(starts(server).map((r) => r.body)).toEqual([
      {
        kind: "create",
        agentId: "default_agent",
        targetAgentId: "default_agent",
        notes: "Cases on conflicting sources",
        approvalMode: "allow-all",
        language: "zh",
      },
    ]);
    expect(shows(zh.benchmark.aiCreateTitle)).toBe(false);

    await click(button(zh.tasks.openChat));

    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: "/chat/session-1",
    });
  });

  it("sends the approval mode picked in the form", async () => {
    const { server } = await openCreateForm();

    await pick(zh.form.approvalMode, zh.form.approvalModes["always-ask"]);
    await click(button(zh.form.start));

    await waitFor(() => starts(server).length === 1, "the start");
    expect(starts(server)[0]!.body).toMatchObject({ approvalMode: "always-ask" });
  });

  it("shows the server's preview of the request as the full prompt", async () => {
    const { server } = await openCreateForm();

    await waitFor(
      () =>
        document
          .querySelector('[data-testid="prompt-preview"]')
          ?.textContent?.includes("conflicting sources") === true,
      "the preview",
    );
    const previews = server.seen("POST", TASKS).filter((r) => r.query.get("preview") === "1");
    expect(previews.at(-1)!.body).toMatchObject({
      kind: "create",
      notes: "Cases on conflicting sources",
    });
    expect(starts(server)).toHaveLength(0);
  });

  it("offers to install the plugin a missing Skill comes in, then starts", async () => {
    const { server } = await openCreateForm();
    let refused = false;
    server.on("POST", TASKS, (request: SeenRequest) => {
      if (request.query.get("preview") === "1") return json({ prompt: "p", skills: [] });
      if (!refused) {
        refused = true;
        return apiError(409, "skill_missing", "The agent lacks benchmark-design.", {
          agentId: "default_agent",
          skill: "benchmark-design",
          plugin: "rsi-workbench",
        });
      }
      return json({ task: task({ kind: "create" }) }, 201);
    });
    server.on(
      "POST",
      "/api/projects/proj/agents/default_agent/plugins",
      json({ installed: ["rsi-workbench"] }),
    );

    await click(button(zh.form.start));
    await waitFor(
      () => shows(zh.tasks.skillMissing("benchmark-design", "rsi-workbench")),
      "the notice",
    );
    expect(shows(zh.benchmark.aiCreateTitle)).toBe(true);

    await click(button(zh.tasks.install));
    await waitFor(() => shows(zh.tasks.installed("rsi-workbench")), "the installed note");
    expect(server.seen("POST", "/api/projects/proj/agents/default_agent/plugins")[0]!.body).toEqual(
      {
        names: ["rsi-workbench"],
      },
    );

    await click(button(zh.form.start));
    await waitFor(() => shows(zh.tasks.started(zh.tasks.kinds.create)), "the confirmation");
    expect(starts(server)).toHaveLength(2);
  });
});

describe("a Benchmark's task list", () => {
  it("is read every five seconds only while the document is visible", async () => {
    let visibility: DocumentVisibilityState = "visible";
    try {
      vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    } catch {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    }
    const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] });
    server.on("GET", "/api/projects/proj/benchmarks/sec-a/cases", { cases: [] });
    server.install();
    fakeHost();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountApp({ at: "/sec-a" });
    const reads = () =>
      server.seen("GET", TASKS).filter((r) => r.query.get("benchmarkId") === "sec-a").length;
    await waitFor(() => reads() === 1, "the first read");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(reads()).toBe(2);

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(reads()).toBe(2);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads()).toBe(3);
  });

  it("is not read while the frame is hidden, as in a minimized window", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      vi.spyOn(window, "frameElement", "get").mockReturnValue(frame);
    } catch {
      Object.defineProperty(window, "frameElement", { configurable: true, get: () => frame });
    }
    try {
      const server = serveProject(new FakeServer(), { benchmarks: [benchmark()] });
      server.on("GET", "/api/projects/proj/benchmarks/sec-a/cases", { cases: [] });
      server.install();
      fakeHost();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await mountApp({ at: "/sec-a" });
      const reads = () =>
        server.seen("GET", TASKS).filter((r) => r.query.get("benchmarkId") === "sec-a").length;
      await waitFor(() => reads() === 1, "the first read");

      frame.style.visibility = "hidden";
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(reads()).toBe(1);

      frame.style.visibility = "";
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(reads()).toBe(2);
    } finally {
      frame.remove();
    }
  });
});
