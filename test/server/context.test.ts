/**
 * What the page reads about the Project (GET …/benchmarks/context).
 *
 * Given a Project with conversation Agents, the system Agent, models and a plugin library:
 * - a member reads their role, the Project's conversation Agents with their Skills (never the
 *   system Agent), the default Agent, the models and the default model, and the folder the
 *   Benchmarks are in;
 * - the Optimize methods are the library's RSI toolkits only, the default loop first, each with
 *   the Skill it runs; this plugin, filed under the same category, is no toolkit;
 * - a library that cannot be read leaves the methods empty rather than failing the page;
 * - only an admin sees the machines; an outsider sees nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { WorkbenchContext } from "../../src/api.js";
import { createTestHost, type TestHost } from "../helpers/host.js";

const CONTEXT = "/api/projects/p1/benchmarks/context";

const LIBRARY = [
  {
    name: "opro-rsi-toolkit",
    category: "rsi",
    title: "OPRO",
    titleZh: "OPRO 优化",
    shortDescription: "Optimize by prompting.",
    skills: [{ name: "opro-rsi-toolkit" }],
  },
  {
    name: "default-rsi-toolkit",
    category: "rsi",
    title: "Default RSI Toolkit",
    skills: [{ name: "agent-optimization" }],
  },
  { name: "rsi-workbench", category: "rsi", skills: [{ name: "agent-evaluation" }] },
  { name: "a2ui", category: "office-productivity", skills: [{ name: "a2ui" }] },
  // A toolkit whose manifest settles no Skill is not offered.
  {
    name: "vague-rsi-toolkit",
    category: "rsi",
    skills: [{ name: "one" }, { name: "two" }],
  },
];

describe("workbench context", () => {
  let host: TestHost;
  afterEach(async () => {
    await host.dispose();
  });

  it("gives a member the Project's conversation Agents, models and Benchmark folder", async () => {
    host = await createTestHost({ library: LIBRARY });
    const res = await host.request("GET", CONTEXT, { user: "bob" });
    expect(res.status).toBe(200);
    const context = (await res.json()) as WorkbenchContext;
    expect(context).toMatchObject({
      projectId: "p1",
      role: "member",
      isAdmin: false,
      dir: host.benchmarksDir("p1"),
      defaultAgentId: "default_agent",
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      ],
      defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      machines: [],
    });
    expect(context.agents).toEqual([
      { agentId: "default_agent", skills: ["agent-evaluation", "benchmark-design"] },
      { agentId: "writer", name: "Writer", skills: [] },
    ]);
  });

  it("offers the library's RSI toolkits as methods, the default loop first", async () => {
    host = await createTestHost({ library: LIBRARY });
    const context = (await (await host.request("GET", CONTEXT)).json()) as WorkbenchContext;
    expect(context.role).toBe("owner");
    expect(context.methods.map((m) => [m.plugin, m.kind, m.skill])).toEqual([
      ["default-rsi-toolkit", "default", "agent-optimization"],
      ["opro-rsi-toolkit", "paper", "opro-rsi-toolkit"],
    ]);
    expect(context.methods[1]).toMatchObject({
      label: "OPRO",
      labelZh: "OPRO 优化",
      hint: "Optimize by prompting.",
      hintZh: "Optimize by prompting.",
    });
  });

  it("still answers when the library cannot be read, with no methods", async () => {
    host = await createTestHost({ libraryFails: true });
    const res = await host.request("GET", CONTEXT);
    expect(res.status).toBe(200);
    expect(((await res.json()) as WorkbenchContext).methods).toEqual([]);
  });

  it("names the default Agent as the first conversation Agent when there is no default_agent", async () => {
    host = await createTestHost({
      projects: {
        p1: {
          owner: "alice",
          agents: [{ agentId: "system_agent", system: true }, { agentId: "solo" }],
        },
      },
    });
    const context = (await (await host.request("GET", CONTEXT)).json()) as WorkbenchContext;
    expect(context.defaultAgentId).toBe("solo");
    expect(context.defaultModel).toBeNull();
  });

  it("lists the machines to an admin only, and nothing to an outsider", async () => {
    const machine = await createTestHost();
    host = await createTestHost({ machines: { m1: machine, m2: null } });
    try {
      const admin = (await (
        await host.request("GET", CONTEXT, { admin: true })
      ).json()) as WorkbenchContext;
      expect(admin.isAdmin).toBe(true);
      expect(admin.machines).toEqual([
        { machineId: "m1", label: "m1.example.test" },
        { machineId: "m2", label: "m2.example.test" },
      ]);
      const owner = (await (await host.request("GET", CONTEXT)).json()) as WorkbenchContext;
      expect(owner.machines).toEqual([]);
      expect((await host.request("GET", CONTEXT, { user: "mallory" })).status).toBe(404);
    } finally {
      await machine.dispose();
    }
  });
});
