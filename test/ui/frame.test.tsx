/**
 * The page in the App Center's window: what the host tells it and what it tells the host.
 *
 * - Given no `data-project-id` on `<html>`, the page shows nothing; once the host writes one, the
 *   list appears.
 * - Given a fragment naming a Benchmark (`#/sec-a`), the page opens on that Benchmark.
 * - When the person moves inside the page, the page replaces its own history entry and posts
 *   `penguin:location` with the new location to the host, on its own origin.
 * - When the host posts `penguin:location`, the page goes there without reloading and posts
 *   nothing back; the same message from anywhere but the host is ignored.
 * - When the host changes `lang` on `<html>`, the page switches language; when it changes
 *   `data-project-id`, the page reads the new Project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, zh } from "../../src/ui/strings";
import {
  FakeServer,
  benchmark,
  button,
  cardButton,
  click,
  fakeHost,
  lastPosted,
  mountApp,
  serveProject,
  settle,
  shows,
  unmountAll,
  waitFor,
  type FakeHost,
} from "./helpers";

let server: FakeServer;
let host: FakeHost;

beforeEach(() => {
  server = serveProject(new FakeServer(), {
    benchmarks: [
      benchmark({ id: "sec-a", title: "Sec A" }),
      benchmark({ id: "sec-b", title: "Sec B" }),
    ],
  }).install();
  host = fakeHost();
});

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const heading = () => document.querySelector("h1")?.textContent ?? "";

describe("the page in the App Center's window", () => {
  it("shows nothing until the host names a Project, then the list", async () => {
    const container = await mountApp({ projectId: null });
    expect(container.textContent).toBe("");

    document.documentElement.setAttribute("data-project-id", "proj");
    await waitFor(() => shows("Sec A"), "the list");

    expect(heading()).toBe(zh.appTitle);
  });

  it("opens the Benchmark the starting fragment names", async () => {
    await mountApp({ at: "/sec-a" });

    await waitFor(() => heading() === "Sec A", "the Benchmark's page");
    expect(button(zh.benchmark.backToList)).toBeTruthy();
  });

  it("replaces its history entry and tells the host on every move inside it", async () => {
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
  });

  it("goes where the host's location message says, without reloading or answering", async () => {
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

  it("switches language when the host changes lang on <html>", async () => {
    await mountApp({ lang: "zh-CN" });
    await waitFor(() => heading() === zh.appTitle, "the Chinese page");

    document.documentElement.setAttribute("lang", "en");

    await waitFor(() => heading() === en.appTitle, "the English page");
    expect(shows(en.benchmark.use)).toBe(true);
  });

  it("reads the new Project when the host switches Project", async () => {
    serveProject(server, {
      projectId: "other",
      benchmarks: [benchmark({ id: "other-bench", title: "Other bench" })],
    });
    await mountApp();
    await waitFor(() => shows("Sec A"), "the first Project's list");

    document.documentElement.setAttribute("data-project-id", "other");

    await waitFor(() => shows("Other bench"), "the second Project's list");
    expect(shows("Sec A")).toBe(false);
    expect(server.seen("GET", "/api/projects/other/benchmarks/context")).toHaveLength(1);
  });

  it("leaves an open Benchmark for the new Project's list when the host switches Project", async () => {
    serveProject(server, {
      projectId: "other",
      benchmarks: [benchmark({ id: "other-bench", title: "Other bench" })],
    });
    server.on("GET", "/api/projects/proj/benchmarks/sec-a/cases", { cases: [] });
    await mountApp({ at: "/sec-a" });
    await waitFor(() => heading() === "Sec A", "the Benchmark's page");

    document.documentElement.setAttribute("data-project-id", "other");

    await waitFor(() => shows("Other bench"), "the second Project's list");
    expect(lastPosted(host, "penguin:location")).toEqual({ type: "penguin:location", at: "/" });
  });
});
