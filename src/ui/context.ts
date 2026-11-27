/**
 * What every part of the page reads without having it passed down: the strings table of the
 * interface language, and the workbench itself — whose workbench it is and where its routes are,
 * the Project as the viewer sees it (context-load.ts), the viewer's currency, where the page is,
 * and the few actions that reach outside a dialog (moving, opening a conversation, announcing a
 * started task).
 */
import { createContext, useContext } from "react";
import type { WorkbenchAgent, WorkbenchContext, WorkbenchTask } from "../api";
import type { HostApi, WorkbenchApi } from "./api";
import type { AgentSkills } from "./agent-skills";
import type { Currency } from "./format";
import type { Locale, PageAddress } from "./frame-facts";
import type { SourceResolver } from "./machine-sources";
import type { Route } from "./router";
import { zh, type Strings } from "./strings";

export const StringsContext = createContext<Strings>(zh);

/** The words of the interface language. */
export function useStrings(): Strings {
  return useContext(StringsContext);
}

export interface WorkbenchValue {
  address: PageAddress;
  /** This workbench's handler. */
  api: WorkbenchApi;
  /** The Web App's routes, on the server the page came from. */
  host: HostApi;
  /** Where each server's copies are read from (this server's handler, a machine's). */
  sources: SourceResolver;
  /** The Skills installed on each Agent, read when a form needs them. */
  skills: AgentSkills;
  locale: Locale;
  context: WorkbenchContext;
  currency: Currency;
  /** The Agents a task can go to (the system Agent is never among them). */
  agents: readonly WorkbenchAgent[];
  /** The Agent a task goes to unless a form picks another; null in a Project with none. */
  defaultAgentId: string | null;
  agentName: (agentId: string) => string;
  /** An Agent's own picture, or undefined to draw its default; a machine's Agents have none here. */
  agentPicture: (agentId: string, machineId?: string | null) => string | undefined;
  /** The name a machine goes by on this server, or null for this server. */
  machineName: (machineId: string | null) => string | null;
  route: Route;
  go: (route: Route) => void;
  /** Takes the viewer to a conversation; the host minimizes the window. */
  openSession: (sessionId: string) => void;
  /** A task was started from a form: the confirmation shows and the task lists read again. */
  started: (task: WorkbenchTask) => void;
  /** The task just started, until its confirmation is dismissed. */
  lastStarted: WorkbenchTask | null;
  dismissStarted: () => void;
  /** Bumped whenever a task starts, so every task list reads again. */
  tasksKey: number;
}

export const WorkbenchCtx = createContext<WorkbenchValue | null>(null);

export function useWorkbench(): WorkbenchValue {
  const value = useContext(WorkbenchCtx);
  if (value === null) throw new Error("useWorkbench outside the workbench");
  return value;
}
