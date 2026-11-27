/**
 * Starting an Agent task from a form, opening its conversation, and the tasks the page lists.
 *
 * - When the person fills Create with AI and presses Start, the page asks the handler for the
 *   prompt, reads the Agent's Skills, opens a conversation on that Agent with the form's approval
 *   mode, sends the prompt as its first message behind a `[use_skills]` block, and records the
 *   task with the handler — in that order; the form closes and a confirmation offers Open chat.
 * - The first message names only the Skills the Agent has; a task that can do without a missing
 *   one starts all the same.
 * - When the Agent lacks a Skill the task cannot do without, nothing starts: the form stays open
 *   with a notice naming the Skill and the plugin that ships it, Install installs that plugin on
 *   the Agent, and Start then goes through.
 * - The form's full prompt is the handler's, asked with the form's prompt fields alone.
 * - Open chat asks the host to take the viewer to `/chat/<sessionId>`; a host that minimizes the
 *   window takes it from there, and when nothing hides the page a moment later (an older host),
 *   the page sends the whole tab there itself.
 * - A task row shows the kind, its conversation's title and where it stands — running (compacting
 *   too), waiting on an approval, or done; a conversation the viewer cannot read is not listed, a
 *   finished one is not read again, and one that finishes has the Benchmarks read again.
 * - A Benchmark's task list is read every five seconds while the document is visible, not at all
 *   while it is hidden, and at once when it shows again; nor while the frame is hidden (a minimized
 *   App Center window), and again once it is shown.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAVIGATE_FALLBACK_MS } from "../../src/ui/bridge";
import { zh } from "../../src/ui/strings";
import {
  BENCHMARKS,
  FakeServer,
  NEW_SESSION,
  PROMPT,
  TASKS,
  agentPath,
  apiError,
  benchmark,
  button,
  click,
  fakeHost,
  field,
  json,
  lastPosted,
  messageText,
  mountApp,
  pick,
  pressStart,
  promptBox,
  promptText,
  record,
  serveProject,
  session,
  shows,
  startRequests,
  startedTask,
  taskRows,
  type,
  unmountAll,
  waitFor,
  type ProjectFixture,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openCreateForm(fixture: ProjectFixture = {}) {
  const server = serveProject(new FakeServer(), {
    benchmarks: [benchmark()],
    ...fixture,
  }).install();
  const host = fakeHost();
  await mountApp();
  await waitFor(() => shows("Sec A"), "the list");
  await click(button(zh.form.withAi));
  await type(promptBox(zh.form.promptLabel), "Cases on conflicting sources");
  return { server, host };
}

describe("starting a task", () => {
  it("asks for the prompt, checks the Skills, opens the conversation, sends the prompt and records the task, in order", async () => {
    const { server } = await openCreateForm();

    const from = await pressStart(server);
    const calls = await startedTask(server, from);

    expect(calls.sequence).toEqual([
      `POST ${PROMPT}`,
      `GET ${agentPath("default_agent")}/skills`,
      `POST ${agentPath("default_agent")}/sessions`,
      `POST /api/sessions/${NEW_SESSION}/tasks`,
      `POST ${TASKS}`,
    ]);
    expect(calls.prompt.body).toEqual({
      kind: "create",
      targetAgentId: "default_agent",
      notes: "Cases on conflicting sources",
      language: "zh",
    });
    expect(calls.session.body).toEqual({ approvalMode: "allow-all" });
    expect(messageText(calls.message)).toBe(
      `[use_skills]\nskills: benchmark-design, agent-evaluation\n[/use_skills]\n\n${promptText("create")}`,
    );
    expect(calls.record.body).toEqual({
      sessionId: NEW_SESSION,
      kind: "create",
      agentId: "default_agent",
      approvalMode: "allow-all",
    });
    await waitFor(() => shows(zh.tasks.started(zh.tasks.kinds.create)), "the confirmation");
    expect(shows(zh.benchmark.aiCreateTitle)).toBe(false);
  });

  it("opens the conversation and records the task with the approval mode picked in the form", async () => {
    const { server } = await openCreateForm();

    await pick(zh.form.approvalMode, zh.form.approvalModes["always-ask"]);
    const calls = await startedTask(server, await pressStart(server));

    expect(calls.session.body).toEqual({ approvalMode: "always-ask" });
    expect(calls.record.body).toMatchObject({ approvalMode: "always-ask" });
  });

  it("names only the Skills the Agent has, and starts a task that can do without the one it lacks", async () => {
    const server = serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      skills: { default_agent: ["agent-evaluation"] },
    }).install();
    fakeHost();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");
    await click(button(zh.benchmark.importBenchmark));
    await type(field(zh.benchmark.importSourceLabel), "https://example.invalid/benchmarks/sec-e");

    const calls = await startedTask(server, await pressStart(server));

    expect(calls.prompt.body).toMatchObject({
      kind: "import",
      source: "https://example.invalid/benchmarks/sec-e",
    });
    expect(messageText(calls.message)).toBe(promptText("import"));
    expect(calls.record.body).toMatchObject({ kind: "import", sessionId: NEW_SESSION });
  });

  it("offers to install the plugin of a missing Skill instead of starting, then starts once it is installed", async () => {
    const { server } = await openCreateForm({ skills: { default_agent: [] } });

    const from = await pressStart(server);
    await waitFor(
      () => shows(zh.tasks.skillMissing("benchmark-design", "rsi-workbench")),
      "the notice",
    );
    expect(startRequests(server, from).map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${PROMPT}`,
      `GET ${agentPath("default_agent")}/skills`,
    ]);
    expect(shows(zh.benchmark.aiCreateTitle)).toBe(true);

    await click(button(zh.tasks.install));
    await waitFor(() => shows(zh.tasks.installed("rsi-workbench")), "the installed note");
    expect(server.seen("POST", `${agentPath("default_agent")}/plugins`).map((r) => r.body)).toEqual(
      [{ names: ["rsi-workbench"] }],
    );

    const calls = await startedTask(server, await pressStart(server));
    expect(calls.sequence).toContain(`GET ${agentPath("default_agent")}/skills`);
    expect(messageText(calls.message)).toContain("skills: benchmark-design, agent-evaluation");
    await waitFor(() => shows(zh.tasks.started(zh.tasks.kinds.create)), "the confirmation");
  });

  it("shows the handler's prompt for the form, asked with the prompt's fields alone", async () => {
    const { server } = await openCreateForm();

    await waitFor(
      () =>
        document.querySelector('[data-testid="prompt-preview"]')?.textContent ===
        promptText("create"),
      "the preview",
    );
    await waitFor(
      () =>
        server
          .seen("POST", PROMPT)
          .some((r) => (r.body as { notes?: string }).notes === "Cases on conflicting sources"),
      "the typed notes asked for",
    );
    expect(server.seen("POST", PROMPT).at(-1)!.body).toEqual({
      kind: "create",
      targetAgentId: "default_agent",
      notes: "Cases on conflicting sources",
      language: "zh",
    });
    expect(server.requests.filter((r) => r.path.endsWith("/sessions"))).toEqual([]);
  });
});

describe("opening a task's conversation", () => {
  async function openRow(answersNavigate: boolean) {
    serveProject(new FakeServer(), {
      benchmarks: [benchmark()],
      tasks: [record({ sessionId: "s-1", kind: "create" })],
      sessions: { "s-1": session({ sessionId: "s-1", title: "Write report cases" }) },
    }).install();
    const host = fakeHost({ answersNavigate });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountApp();
    await waitFor(() => shows("Write report cases"), "the task row");
    await click(button(zh.tasks.openChat));
    return host;
  }

  it("asks the host to go to the conversation, and leaves the rest to a host that minimizes the window", async () => {
    const host = await openRow(true);

    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: "/chat/s-1",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NAVIGATE_FALLBACK_MS);
    });
    expect(host.assigned).toEqual([]);
  });

  it("takes the whole tab to the conversation when the page is still shown a moment later", async () => {
    const host = await openRow(false);

    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: "/chat/s-1",
    });
    expect(host.assigned).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NAVIGATE_FALLBACK_MS);
    });
    expect(host.assigned).toEqual(["/chat/s-1"]);
  });

  it("opens the conversation a task just started from its confirmation", async () => {
    const { server, host } = await openCreateForm();
    await startedTask(server, await pressStart(server));
    await waitFor(() => shows(zh.tasks.started(zh.tasks.kinds.create)), "the confirmation");

    await click(button(zh.tasks.openChat));

    expect(lastPosted(host, "penguin:navigate")).toEqual({
      type: "penguin:navigate",
      to: `/chat/${NEW_SESSION}`,
    });
  });
});

describe("a task list", () => {
  const onSecA = (sessionId: string, kind: "evaluate" | "optimize" | "ask" = "evaluate") =>
    record({ sessionId, kind, benchmarkId: "sec-a" });

  async function openBenchmark(fixture: ProjectFixture) {
    const server = serveProject(new FakeServer(), { benchmarks: [benchmark()], ...fixture });
    server.install();
    const host = fakeHost();
    await mountApp({ at: "/sec-a" });
    return { server, host };
  }

  const rowOf = (title: string) => {
    const row = taskRows(zh.tasks.title).find((li) => li.textContent?.includes(title));
    if (row === undefined) throw new Error(`no task row ${title}`);
    return row;
  };

  it("shows each task's kind, its conversation's title and where it stands, leaving out one it cannot read", async () => {
    await openBenchmark({
      tasks: [
        onSecA("s-run"),
        onSecA("s-compact", "optimize"),
        onSecA("s-wait"),
        onSecA("s-done", "ask"),
        onSecA("s-gone"),
      ],
      sessions: {
        "s-run": session({ sessionId: "s-run", title: "Evaluate the ticket agent" }),
        "s-compact": session({ sessionId: "s-compact", title: "Improve", status: "compacting" }),
        "s-wait": session({ sessionId: "s-wait", title: "Needs a yes", pendingApprovalCount: 1 }),
        "s-done": session({ sessionId: "s-done", title: "Why so low", status: "idle" }),
        "s-gone": apiError(403, "forbidden"),
      },
    });
    await waitFor(() => taskRows(zh.tasks.title).length > 0, "the task rows");

    expect(taskRows(zh.tasks.title)).toHaveLength(4);
    expect(rowOf("Evaluate the ticket agent").textContent).toContain(zh.tasks.kinds.evaluate);
    expect(rowOf("Evaluate the ticket agent").textContent).toContain(zh.tasks.states.running);
    expect(rowOf("Improve").textContent).toContain(zh.tasks.kinds.optimize);
    expect(rowOf("Improve").textContent).toContain(zh.tasks.states.running);
    expect(rowOf("Needs a yes").textContent).toContain(zh.tasks.states.waiting);
    expect(rowOf("Why so low").textContent).toContain(zh.tasks.kinds.ask);
    expect(rowOf("Why so low").textContent).toContain(zh.tasks.states.done);
  });

  it("does not read a finished task's conversation again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { server } = await openBenchmark({
      tasks: [onSecA("s-run"), onSecA("s-done")],
      sessions: {
        "s-run": session({ sessionId: "s-run", title: "Still going" }),
        "s-done": session({ sessionId: "s-done", title: "Finished", status: "idle" }),
      },
    });
    await waitFor(() => shows("Finished"), "the task rows");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(server.seen("GET", "/api/sessions/s-run")).toHaveLength(2);
    expect(server.seen("GET", "/api/sessions/s-done")).toHaveLength(1);
    expect(shows("Finished")).toBe(true);
  });

  it("reads the Benchmarks again when a task it lists finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { server } = await openBenchmark({
      tasks: [onSecA("s-run")],
      sessions: { "s-run": session({ sessionId: "s-run", title: "Evaluate" }) },
    });
    await waitFor(() => shows("Evaluate"), "the task row");
    const reads = server.seen("GET", BENCHMARKS).length;

    server.on(
      "GET",
      "/api/sessions/s-run",
      json({ session: session({ sessionId: "s-run", title: "Evaluate", status: "idle" }) }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => server.seen("GET", BENCHMARKS).length > reads, "the list read again");
    expect(rowOf("Evaluate").textContent).toContain(zh.tasks.states.done);
  });

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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { server } = await openBenchmark({});
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { server, host } = await openBenchmark({});
    const reads = () =>
      server.seen("GET", TASKS).filter((r) => r.query.get("benchmarkId") === "sec-a").length;
    await waitFor(() => reads() === 1, "the first read");

    host.frame.style.visibility = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(reads()).toBe(1);

    host.frame.style.visibility = "";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(reads()).toBe(2);
  });
});
