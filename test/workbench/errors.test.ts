/**
 * What the handler answers when it refuses (workbenches/benchmark/lib/errors.ts), at the wire.
 *
 * Given a workbench:
 * - When a request names no route (an unknown path, or a known one under a method it does not
 *   take), the answer is 404 `not_found` in the host's error shape, `{ error: { code, message } }`.
 * - When something other than a refusal is thrown (a state write that fails, a manifest the disk
 *   cannot read), the answer is a bare 500 `internal`: what went wrong reaches the host's log and
 *   never the answer.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestWorkbench, statusOf, type TestWorkbench } from "../helpers/workbench.js";

describe("refusals", () => {
  let wb: TestWorkbench;

  beforeEach(async () => {
    wb = await createTestWorkbench();
  });
  afterEach(async () => {
    await wb.dispose();
  });

  it.each([
    ["GET", "/"],
    ["GET", "/nothing"],
    ["PUT", "/benchmarks"],
    ["GET", "/benchmarks/report-writing-v1/unknown"],
    ["PATCH", "/benchmarks/report-writing-v1"],
    ["POST", "/benchmarks/report-writing-v1/archive"],
    ["GET", "/prompt/extra"],
    ["DELETE", "/tasks"],
  ])("%s %s is not found, in the host's error shape", async (method, url) => {
    const res = await wb.request(method, url, { body: {} });

    expect(statusOf(res)).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("a state write that fails is a bare 500 whose cause reaches the host's log, not the answer", async () => {
    wb.host.setState = async () => {
      throw new Error("EIO: i/o error, write '/srv/secret/state.json'");
    };

    const res = await wb.post("/tasks", {
      sessionId: "session-1",
      kind: "create",
      agentId: "default_agent",
      approvalMode: "allow-all",
    });

    expect(statusOf(res)).toBe(500);
    expect(res.body).toEqual({ error: { code: "internal", message: expect.any(String) } });
    expect(JSON.stringify(res)).not.toContain("/srv/secret");
    expect(wb.host.lines.some((line) => line.includes("/srv/secret/state.json"))).toBe(true);
  });

  it("a manifest the disk cannot read is a bare 500 whose cause reaches the host's log, not the answer", async () => {
    // A directory where the file should be: reading it is a filesystem error, not a verdict.
    const manifest = path.join(wb.dataDir, "odd-bench", "benchmark_config.toml");
    await fs.mkdir(manifest, { recursive: true });

    const res = await wb.get("/benchmarks");

    expect(statusOf(res)).toBe(500);
    expect(res.body).toEqual({ error: { code: "internal", message: expect.any(String) } });
    expect(JSON.stringify(res)).not.toContain(wb.dataDir);
    expect(wb.host.lines.some((line) => line.includes("EISDIR"))).toBe(true);
  });
});
