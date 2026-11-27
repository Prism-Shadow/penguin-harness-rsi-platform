/**
 * The page in the App Center's window: what it reads from where it is, and what it and the host
 * tell each other.
 *
 * - Given its own address, the page reads the Project, the Agent and the workbench from it and
 *   asks that workbench's handler and that Project's routes. Served through the host's machine
 *   proxy (`/server/<machineId>/api/…`), it asks that machine for everything; at an address that is
 *   no workbench page's, it says to open it in the workbench and asks nothing.
 * - Given `lang` on the frame's root, the page speaks that language, whatever the parent's; given
 *   none, the parent document's. Either is followed live.
 * - Given a fragment naming a Benchmark (`#/sec-a`), the page opens on that Benchmark.
 * - When the person moves inside the page, the page replaces its own history entry and posts
 *   `penguin:location` with the new location to the host, on its own origin.
 * - When the host posts `penguin:location`, the page goes there without reloading and posts
 *   nothing back; the same message from anywhere but the host is ignored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { en, zh } from "../../src/ui/strings";
import {
  FakeServer,
  benchmark,
  button,
  cardButton,
  click,
  fakeHost,
  handlerOf,
  lastPosted,
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

const heading = () => document.querySelector("h1")?.textContent ?? "";

const twoBenchmarks = () =>
  serveProject(new FakeServer(), {
    benchmarks: [
      benchmark({ id: "sec-a", title: "Sec A" }),
      benchmark({ id: "sec-b", title: "Sec B" }),
    ],
  }).install();

describe("whose workbench the page is", () => {
  it("asks the workbench and the Project its address names", async () => {
    const where = { projectId: "team-x", agentId: "writer", workbenchId: "bench-2" };
    const server = serveProject(new FakeServer(), {
      ...where,
      benchmarks: [benchmark({ title: "Team bench" })],
    }).install();
    await mountApp(where);

    await waitFor(() => shows("Team bench"), "the list");
    expect(server.seen("GET", `${handlerOf(where)}/benchmarks`)).toHaveLength(1);
    expect(server.seen("GET", "/api/projects/team-x/agents")).toHaveLength(1);
    const elsewhere = server.requests.filter(
      (r) =>
        !r.path.startsWith("/api/projects/team-x/") &&
        !["/api/me", "/api/me/prefs", "/api/plugins"].includes(r.path),
    );
    expect(elsewhere).toEqual([]);
  });

  it("asks the machine it is served from for everything", async () => {
    const where = { apiBase: "/server/m1/api" };
    const server = serveProject(new FakeServer(), {
      ...where,
      benchmarks: [benchmark({ title: "On the machine" })],
    }).install();
    await mountApp(where);

    await waitFor(() => shows("On the machine"), "the list");
    expect(server.seen("GET", `${handlerOf(where)}/benchmarks`)).toHaveLength(1);
    expect(server.requests.filter((r) => !r.path.startsWith("/server/m1/api/"))).toEqual([]);
  });

  it("says to open it in the workbench, and asks nothing, at an address that is no workbench page's", async () => {
    const server = serveProject(new FakeServer()).install();
    await mountApp({ path: "/plugins/rsi-workbench/ui/index.html" });

    expect(shows(zh.common.notInWorkbench)).toBe(true);
    expect(server.requests).toEqual([]);
  });
});

describe("the page's language", () => {
  it("is the one on the frame's root, whatever the parent's", async () => {
    twoBenchmarks();
    fakeHost({ lang: "en" });
    await mountApp({ lang: "zh-CN" });

    await waitFor(() => shows("Sec A"), "the list");
    expect(heading()).toBe(zh.appTitle);
  });

  it("follows the host when it changes lang on the frame's root", async () => {
    twoBenchmarks();
    await mountApp({ lang: "zh-CN" });
    await waitFor(() => heading() === zh.appTitle, "the Chinese page");

    document.documentElement.setAttribute("lang", "en");

    await waitFor(() => heading() === en.appTitle, "the English page");
    expect(shows(en.benchmark.use)).toBe(true);
  });

  it("is the parent document's when the frame's root names none, followed live", async () => {
    twoBenchmarks();
    const host = fakeHost({ lang: "en-US" });
    await mountApp({ lang: null });
    await waitFor(() => heading() === en.appTitle, "the English page");

    host.root.setAttribute("lang", "zh-CN");

    await waitFor(() => heading() === zh.appTitle, "the Chinese page");
  });
});

describe("the page in the App Center's window", () => {
  it("opens the Benchmark the starting fragment names", async () => {
    twoBenchmarks();
    await mountApp({ at: "/sec-a" });

    await waitFor(() => heading() === "Sec A", "the Benchmark's page");
    expect(button(zh.benchmark.backToList)).toBeTruthy();
  });

  it("replaces its history entry and tells the host on every move inside it", async () => {
    twoBenchmarks();
    const host = fakeHost();
    await mountApp();
    await waitFor(() => shows("Sec B"), "the list");
    const entries = window.history.length;

    await click(cardButton("Sec B", zh.benchmark.view));

    await waitFor(() => heading() === "Sec B", "the Benchmark's page");
    expect(window.location.hash).toBe("#/sec-b");
    expect(window.history.length).toBe(entries);
    expect(host.posted.at(-1)).toEqual({
      message: { type: "penguin:location", at: "/sec-b" },
      targetOrigin: window.location.origin,
    });

    await click(button(zh.benchmark.backToList));

    await waitFor(() => heading() === zh.appTitle, "the list");
    expect(lastPosted(host, "penguin:location")).toEqual({ type: "penguin:location", at: "/" });
  });

  it("goes where the host's location message says, without reloading or answering", async () => {
    twoBenchmarks();
    const host = fakeHost();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");
    const marker = Symbol("same document");
    (window as unknown as Record<symbol, boolean>)[marker] = true;

    await host.send({ type: "penguin:location", at: "/sec-a" });

    await waitFor(() => heading() === "Sec A", "the Benchmark's page");
    expect((window as unknown as Record<symbol, boolean>)[marker]).toBe(true);
    expect(window.location.hash).toBe("#/sec-a");
    expect(lastPosted(host, "penguin:location")).toBeUndefined();
  });

  it("ignores a location message that does not come from the host", async () => {
    twoBenchmarks();
    const host = fakeHost();
    await mountApp();
    await waitFor(() => shows("Sec A"), "the list");

    await host.send({ type: "penguin:location", at: "/sec-a" }, { source: {} });
    await host.send(
      { type: "penguin:location", at: "/sec-a" },
      { origin: "https://elsewhere.invalid" },
    );
    await settle(20);

    expect(heading()).toBe(zh.appTitle);
  });
});
