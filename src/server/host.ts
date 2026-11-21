/**
 * What the workbench's server module requires of the host, each declared here as the plugin sees
 * it. The kernel matches a requirement to the host interface that structurally satisfies it, so a
 * view names only the members the plugin calls and the package never imports the server.
 *
 *   AppData           the system Agent's folders for one app of a Project (PRFC-0032 levels,
 *                     PRFC-0034 layout): where the Benchmarks are, and where task records go
 *   AgentTasks        a conversation of a person, started from the server the way the Web App's
 *                     Send starts one, and where it stands
 *   ProjectAccess     who may see a Project, and who owns it
 *   ProjectAgents     the Project's Agents (the host's AgentService)
 *   AgentSkills       the Skills installed on one Agent
 *   ProjectModels     the Project's model table (the host's Project config service)
 *   PluginCatalog     the plugin library (the host's PluginLibrary): the RSI toolkits
 *   ProjectMachines   the Project's machines, each with a client to its API (admins only)
 *   CaseFiles         bounded, link-safe listing and reading of files under a folder (the host's
 *                     WorkspaceFiles): a case's statement and rubric
 *
 * AppData, AgentTasks and AgentSkills are new in the harness release this package needs (PRFC-0036
 * "the host's new capabilities"); a host without them cannot load the module, which is the intended
 * failure on a build that still ships its own Evaluation Center.
 */
import { Interface } from "@prismshadow/penguin-core/plugin";
import type { Opaque } from "@prismshadow/penguin-core/plugin";
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import type { CaseFilesResponse } from "../api.js";

/** An app's three folders in one Project, absolute. */
export interface AppDataPaths {
  /** What the app keeps: the Benchmarks, for app `benchmark`. */
  dataDir: string;
  /** What it can rebuild. */
  cacheDir: string;
  /** Its own bookkeeping: the tasks this workbench started. */
  stateDir: string;
}

@Interface()
export abstract class AppData {
  /** The folders, each made before it is returned. */
  abstract dataPaths(projectId: string, appId: string): Promise<AppDataPaths>;
}

/** A configured model, by its pair. */
export interface ModelPair {
  provider: string;
  modelId: string;
}

/** What starting a task takes: whose conversation, on which Agent, saying what. */
export interface AgentTaskStart {
  /** The person the conversation belongs to and whose turn drives it. */
  userId: string;
  projectId: string;
  agentId: string;
  /** The person's message. */
  prompt: string;
  approvalMode: "allow-all" | "deny-all" | "read-only" | "always-ask";
  /** Skills the message preselects (the `[use_skills]` block). */
  skills?: string[];
  /** The conversation's model; the Project's default when absent. */
  model?: ModelPair;
}

/** Where a started conversation stands, as the person who owns it sees it. */
export interface AgentTaskStatus {
  /** The Session's state; `running` while a turn is under way. */
  status: string;
  title?: string | null;
  /** Steps waiting for someone to approve them. */
  pendingApprovals: number;
  /** Set when the last turn ended in an error. */
  failed?: boolean;
}

@Interface()
export abstract class AgentTasks {
  abstract start(task: AgentTaskStart): Promise<{ sessionId: string }>;
  /** Null when the Session is gone or is not the user's to see. */
  abstract status(userId: string, sessionId: string): Promise<AgentTaskStatus | null>;
}

@Interface()
export abstract class ProjectAccess {
  /** Throws the host's 404 unless the user can see the Project; their role otherwise. */
  abstract requireProjectAccess(userId: string, projectId: string): { role: "owner" | "member" };
  /** Throws the host's 403 unless the user owns the Project. */
  abstract requireProjectOwner(userId: string, projectId: string): void;
}

/** An Agent as the Project's list gives it. */
export interface AgentListView {
  agentId: string;
  name?: string;
  description?: string;
  /** The system Agent, which runs no conversation. */
  system?: true;
  avatarRev?: string;
}

@Interface()
export abstract class ProjectAgents {
  abstract listAgents(projectId: string): Promise<AgentListView[]>;
}

@Interface()
export abstract class AgentSkills {
  /** The names of the Skills installed on the Agent. */
  abstract installedSkills(projectId: string, agentId: string): Promise<string[]>;
}

/** The part of a Project's model table the workbench reads. */
export interface ModelTableView {
  defaultModel?: ModelPair;
  models: { provider: string; modelId: string; displayName?: string }[];
}

@Interface()
export abstract class ProjectModels {
  abstract getModels(projectId: string): Promise<ModelTableView>;
}

/**
 * A library entry, compared by name as the host's table compares it (the host declares it in core,
 * and its shape holds more than data): the plugin reads only its card fields and Skill names.
 */
export type LibraryEntry = Opaque<"LibraryPlugin", LibraryPlugin>;

@Interface()
export abstract class PluginCatalog {
  /** Every plugin in the library, sorted by name. */
  abstract list(): LibraryEntry[];
}

/** A request client to one machine's own API, as this server reaches it. */
export interface MachineApiView {
  request(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }>;
}

@Interface()
export abstract class ProjectMachines {
  /** The machines the Project uses, each with a client while it is connected (null otherwise). */
  abstract projectApis(
    projectId: string,
  ): Promise<Array<{ machineId: string; alias: string; api: MachineApiView | null }>>;
}

/** One file read for a response. */
export interface CaseFileContent {
  data: Buffer;
  fileName: string;
  contentType: string;
  /** A document a browser would run scripts in when shown inline. */
  scriptable: "html" | "svg" | false;
  /** A bounded preview that returned only the beginning of the file. */
  truncated?: boolean;
}

@Interface()
export abstract class CaseFiles {
  abstract list(workspace: string, rel: string): Promise<CaseFilesResponse>;
  abstract read(
    workspace: string,
    rel: string,
    options?: { maxBytes?: number },
  ): Promise<CaseFileContent>;
}
