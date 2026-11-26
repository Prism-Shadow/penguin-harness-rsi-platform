/**
 * The Project as the page needs it, read from the Web App's own routes as the viewer (the
 * workbench's handler knows no viewer): the Agents a task can go to and the one it goes to unless
 * a form says otherwise, the models, the Optimize tab's methods and the plugins that ship each
 * Skill (the plugin library), and — for an admin — the machines whose copies the list merges.
 *
 * The Agents and the models are what every form needs, so a failure to read them fails the load
 * (the page offers Retry). The rest degrades: no library is no methods and no Install, no `me` is
 * no machines, and a machine list an admin cannot read is none.
 */
import type { WorkbenchContext, WorkbenchMachine } from "../api";
import type { HostApi, MachineView, PluginsView } from "./api";
import type { PageAddress } from "./frame-facts";
import { rsiMethods, skillPlugins } from "./methods";

/** The Agent a task goes to unless its form says otherwise. */
export const DEFAULT_AGENT_ID = "default_agent";

/**
 * The machines the Project uses that this server installed on and knows by id, once each: the
 * ones whose copies an admin's list merges.
 */
export function projectMachines(machines: readonly MachineView[]): WorkbenchMachine[] {
  const out = new Map<string, WorkbenchMachine>();
  for (const machine of machines) {
    if (machine.local || machine.member !== true || machine.installed === null) continue;
    if (machine.machineId === null || out.has(machine.machineId)) continue;
    out.set(machine.machineId, { machineId: machine.machineId, label: machine.alias });
  }
  return [...out.values()];
}

export async function loadContext(address: PageAddress, host: HostApi): Promise<WorkbenchContext> {
  const [me, listed, table, library] = await Promise.all([
    host.me().catch(() => null),
    host.agents(),
    host.models(),
    host.plugins().catch((): PluginsView => ({ groups: [] })),
  ]);
  const isAdmin = me?.user?.isAdmin === true;
  const machines = isAdmin
    ? await host.machines().then(
        (res) => projectMachines(res.machines),
        () => [],
      )
    : [];
  const agents = listed.agents
    .filter((agent) => agent.system !== true)
    .map((agent) => ({
      agentId: agent.agentId,
      ...(agent.name !== undefined ? { name: agent.name } : {}),
      ...(agent.description !== undefined ? { description: agent.description } : {}),
      ...(agent.avatarRev !== undefined ? { avatarRev: agent.avatarRev } : {}),
    }));
  return {
    projectId: address.projectId,
    workbenchAgentId: address.agentId,
    isAdmin,
    agents,
    defaultAgentId:
      agents.find((agent) => agent.agentId === DEFAULT_AGENT_ID)?.agentId ??
      agents[0]?.agentId ??
      null,
    models: table.models.map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      ...(model.displayName !== undefined && model.displayName !== ""
        ? { displayName: model.displayName }
        : {}),
    })),
    defaultModel:
      table.defaultModel !== undefined
        ? { provider: table.defaultModel.provider, modelId: table.defaultModel.modelId }
        : null,
    methods: rsiMethods(library),
    skillPlugins: skillPlugins(library),
    machines,
  };
}
