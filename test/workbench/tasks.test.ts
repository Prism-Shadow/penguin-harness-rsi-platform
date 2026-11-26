/**
 * The tasks the page started from this workbench (`POST …/tasks`, `GET …/tasks[?benchmarkId=]`),
 * kept in the workbench's state document (workbenches/benchmark/lib/task-log.ts, through the
 * handler).
 *
 * Given a workbench whose state document starts empty:
 * - When the page records a task it started, the answer is the record with the time it was
 *   recorded, and the list carries it.
 * - When the tasks are listed, the newest comes first, at most fifty of them, and only a
 *   Benchmark's when one is named. A record in the state that is out of shape is passed over.
 * - When records are written, the state document's other keys stay as they are, two records sent
 *   at once both land, the newest five hundred are kept, and a reload of the workbench over the
 *   same state still lists them. A write that fails answers 500 and does not stop the next one.
 * - When a field is out of shape, the answer is a 400 naming it, and nothing is recorded.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  TaskRecord,
  TaskRecordRequest,
  TaskRecordResponse,
  TasksResponse,
} from "../../workbenches/benchmark/lib/api.js";
import { createWorkbench } from "../../workbenches/benchmark/lib/workbench.js";
import {
  createTestWorkbench,
  errorOf,
  requestOf,
  statusOf,
  type TestWorkbench,
} from "../helpers/workbench.js";

const record = (over: Partial<TaskRecordRequest> = {}): TaskRecordRequest => ({
  sessionId: "session-1",
  kind: "evaluate",
  benchmarkId: "sec-a",
  agentId: "default_agent",
  approvalMode: "allow-all",
  ...over,
});

/** A record as the state document keeps one, for a state the host already holds. */
const stored = (sessionId: string): TaskRecord => ({
  ...record({ sessionId }),
  createdAt: "2026-10-08T10:00:00.000Z",
});

describe("the tasks the page started", () => {
  let wb: TestWorkbench;

  afterEach(async () => {
    await wb.dispose();
  });

  const post = async (body: unknown) => wb.post("/tasks", body);
  const sessions = async (query = ""): Promise<string[]> =>
    ((await wb.get(`/tasks${query}`)).body as TasksResponse).tasks.map((t) => t.sessionId);

  describe("over an empty state", () => {
    beforeEach(async () => {
      wb = await createTestWorkbench();
    });

    it("records a task with the time it was recorded, and lists it", async () => {
      const before = Date.now();

      const res = await post(record({ approvalMode: "always-ask" }));

      expect(statusOf(res)).toBe(201);
      const { task } = res.body as TaskRecordResponse;
      expect(task).toEqual({
        ...record({ approvalMode: "always-ask" }),
        createdAt: expect.any(String),
      });
      const createdAt = Date.parse(task.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(Date.now());
      expect((await wb.get("/tasks")).body).toEqual({ tasks: [task] });
    });

    it("lists the newest first, and only a Benchmark's when one is named", async () => {
      await post(record({ sessionId: "s1" }));
      await post(record({ sessionId: "s2", kind: "import", benchmarkId: undefined }));
      await post(record({ sessionId: "s3", kind: "ask", benchmarkId: "sec-b" }));
      await post(record({ sessionId: "s4", kind: "optimize" }));

      expect(await sessions()).toEqual(["s4", "s3", "s2", "s1"]);
      expect(await sessions("?benchmarkId=sec-a")).toEqual(["s4", "s1"]);
      expect(await sessions("?benchmarkId=nothing-here")).toEqual([]);
    });

    it("lists at most the newest fifty", async () => {
      for (let n = 1; n <= 55; n++) await post(record({ sessionId: `s${n}` }));

      const listed = await sessions();

      expect(listed).toHaveLength(50);
      expect(listed[0]).toBe("s55");
      expect(listed.at(-1)).toBe("s6");
    });

    it("lands both of two records sent at once", async () => {
      const answers = await Promise.all([
        post(record({ sessionId: "s1" })),
        post(record({ sessionId: "s2" })),
      ]);

      expect(answers.map(statusOf)).toEqual([201, 201]);
      expect((await sessions()).sort()).toEqual(["s1", "s2"]);
    });

    it("still lists them after a reload of the workbench over the same state", async () => {
      await post(record({ sessionId: "s1" }));
      await post(record({ sessionId: "s2" }));

      const reloaded = createWorkbench(wb.host, { seedsDir: path.join(wb.root, "no-seeds") });
      const res = await reloaded.handle(requestOf("GET", "/tasks"));

      expect((res.body as TasksResponse).tasks.map((t) => t.sessionId)).toEqual(["s2", "s1"]);
    });

    it("answers a write that fails with a 500, and the next record still lands", async () => {
      const setState = wb.host.setState;
      wb.host.setState = async () => {
        throw new Error("EIO: i/o error");
      };
      const failed = await post(record({ sessionId: "s1" }));
      wb.host.setState = setState;

      const next = await post(record({ sessionId: "s2" }));

      expect(statusOf(failed)).toBe(500);
      expect(statusOf(next)).toBe(201);
      expect(await sessions()).toEqual(["s2"]);
    });

    /** [what, the body, the field the refusal names]. */
    const bodies: Array<[string, unknown, string]> = [
      ["no Session", record({ sessionId: undefined as unknown as string }), "sessionId"],
      ["a Session id with a separator", record({ sessionId: "a/b" }), "sessionId"],
      ["a kind nobody defined", { ...record(), kind: "rewrite" }, "kind"],
      ["no Agent", record({ agentId: undefined as unknown as string }), "agentId"],
      ["an Agent id that is no id", record({ agentId: "../writer" }), "agentId"],
      ["an approval mode nobody defined", { ...record(), approvalMode: "yolo" }, "approvalMode"],
      ["a Benchmark id that climbs out", record({ benchmarkId: "../escape" }), "benchmarkId"],
      ["a list where the record goes", [record()], "body"],
    ];

    it.each(bodies)(
      "refuses %s, naming the field, and records nothing",
      async (_what, body, field) => {
        const res = await post(body);

        expect(statusOf(res)).toBe(400);
        expect(errorOf(res).code).toBe("bad_request");
        expect(errorOf(res).message).toContain(field);
        expect(wb.host.state).toBeNull();
      },
    );

    it("refuses a body that is not JSON and a Benchmark filter that is no id", async () => {
      const raw = await wb.request("POST", "/tasks", {
        bytes: new TextEncoder().encode("sessionId=s1"),
      });
      const filter = await wb.get("/tasks?benchmarkId=..%2Fescape");

      expect([statusOf(raw), errorOf(raw).code]).toEqual([400, "bad_request"]);
      expect([statusOf(filter), errorOf(filter).code]).toEqual([400, "bad_request"]);
      expect(errorOf(filter).message).toContain("benchmarkId");
      expect(wb.host.state).toBeNull();
    });
  });

  describe("over a state the host already holds", () => {
    it("keeps the state document's other keys as they are", async () => {
      const layout = { tab: "use", collapsed: ["CASE-001-a"] };
      wb = await createTestWorkbench({ state: { layout, tasks: [] } });

      expect(statusOf(await post(record()))).toBe(201);

      expect(wb.host.state).toMatchObject({ layout });
    });

    it("passes over a record that is out of shape", async () => {
      wb = await createTestWorkbench({
        state: {
          tasks: [
            stored("s1"),
            { sessionId: 3 },
            "torn",
            null,
            { ...stored("s2"), kind: "rewrite" },
          ],
        },
      });

      expect(await sessions()).toEqual(["s1"]);
      expect(statusOf(await post(record({ sessionId: "s3" })))).toBe(201);
      expect(await sessions()).toEqual(["s3", "s1"]);
    });

    it("keeps the newest five hundred, dropping the oldest as a new one arrives", async () => {
      const held = Array.from({ length: 500 }, (_, n) => stored(`old-${n}`));
      wb = await createTestWorkbench({ state: { tasks: held } });

      expect(statusOf(await post(record({ sessionId: "new" })))).toBe(201);

      const tasks = (wb.host.state as { tasks: TaskRecord[] }).tasks;
      expect(tasks).toHaveLength(500);
      expect(tasks[0]!.sessionId).toBe("old-1");
      expect(tasks.at(-1)!.sessionId).toBe("new");
    });
  });
});
