/**
 * Creating a Benchmark by hand, and the id the form proposes for it.
 *
 * - Given a title, the id follows it as it is typed: the title's ASCII letters and digits in kebab
 *   case, accents dropped; a title with no ASCII letter gets `benchmark-<yyyymmdd>` of the local
 *   day; an id the list already holds, in any letter case, takes the first free `-2`, `-3`, … No
 *   request is made for it.
 * - Once the id is edited by hand, the title no longer changes it.
 * - When the form is complete, Create sends the Benchmark to the handler and opens it; an id the
 *   handler refuses as taken is said under the id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "../../src/ui/strings";
import {
  BENCHMARKS,
  FakeServer,
  apiError,
  benchmark,
  button,
  click,
  fakeHost,
  field,
  json,
  lastPosted,
  mountApp,
  serveProject,
  shows,
  type,
  unmountAll,
  waitFor,
} from "./helpers";

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openForm(listed: string[] = []) {
  const server = serveProject(new FakeServer(), {
    benchmarks: [
      benchmark({ title: "Sec A" }),
      ...listed.map((id) => benchmark({ id, title: id })),
    ],
  }).install();
  const host = fakeHost();
  await mountApp();
  await waitFor(() => shows("Sec A"), "the list");
  await click(button(zh.form.manual));
  return { server, host };
}

const idField = () => field(zh.benchmark.idField);
const titleField = () => field(zh.benchmark.titleField);

describe("the id the manual form proposes", () => {
  it("follows the title as it is typed, and asks nothing for it", async () => {
    const { server } = await openForm();
    const before = server.requests.length;

    await type(titleField(), "Report writing");
    expect(idField().value).toBe("report-writing");
    await type(titleField(), "Report writing: Café edition, v2");

    expect(idField().value).toBe("report-writing-cafe-edition-v2");
    expect(server.requests.slice(before)).toEqual([]);
  });

  it("dates the id of a title with no ASCII letter by the local day", async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 26, 9, 30), toFake: ["Date"] });
    await openForm();

    await type(titleField(), "报告写作 2026");

    expect(idField().value).toBe("benchmark-20261126");
  });

  it("takes the first free suffix when the list already holds the id, in any letter case", async () => {
    await openForm(["report-writing", "Report-Writing-2"]);

    await type(titleField(), "Report writing");

    expect(idField().value).toBe("report-writing-3");
  });

  it("stops following the title once the id is edited by hand", async () => {
    await openForm();
    await type(titleField(), "Report writing");

    await type(idField(), "my-own-id");
    await type(titleField(), "Report writing, revised");

    expect(idField().value).toBe("my-own-id");
  });
});

describe("creating by hand", () => {
  async function fillCase() {
    await type(field(zh.benchmark.caseSlugField), "conflicts");
    await type(field(zh.benchmark.caseTitleField), "Conflicting sources");
    await type(field(zh.benchmark.caseStatementField), "Write the report.");
    await type(field(zh.benchmark.caseRubricField), "- 100: the report reconciles the sources.");
  }

  it("sends the Benchmark under the proposed id and opens it", async () => {
    const { server, host } = await openForm();
    server.on("POST", BENCHMARKS, (request) =>
      json({ benchmark: benchmark({ id: (request.body as { id: string }).id }) }, 201),
    );

    await type(titleField(), "Report writing");
    await fillCase();
    await click(button(zh.benchmark.createSubmit));

    await waitFor(() => server.seen("POST", BENCHMARKS).length === 1, "the create");
    expect(server.seen("POST", BENCHMARKS)[0]!.body).toEqual({
      id: "report-writing",
      title: "Report writing",
      runs: 1,
      cases: [
        {
          id: "CASE-001-conflicts",
          title: "Conflicting sources",
          statement: "Write the report.",
          rubric: "- 100: the report reconciles the sources.",
        },
      ],
    });
    await waitFor(
      () => lastPosted(host, "penguin:location")?.at === "/report-writing",
      "the new Benchmark's page",
    );
  });

  it("says the id is taken when the handler refuses it", async () => {
    const { server } = await openForm();
    server.on("POST", BENCHMARKS, apiError(409, "benchmark_exists"));

    await type(titleField(), "Report writing");
    await fillCase();
    await click(button(zh.benchmark.createSubmit));

    await waitFor(() => shows(zh.benchmark.idExists), "the taken id");
    expect(shows(zh.benchmark.manualCreateTitle)).toBe(true);
  });
});
