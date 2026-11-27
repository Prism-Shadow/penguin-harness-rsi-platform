/**
 * The Skills installed on each Agent, as the Web App lists them
 * (`GET /api/projects/:p/agents/:a/skills`), read when a form first names the Agent and kept for
 * the page's life: a form says ahead of Start that the Agent it picked lacks a Skill. Start itself
 * always reads afresh (`read`), and an install forgets what was kept (`forget`), so neither ever
 * acts on a stale answer.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { HostApi } from "./api";

export interface AgentSkills {
  /** What is kept for `agentId`: its Skills' names, or undefined while unknown. */
  known(agentId: string): readonly string[] | undefined;
  /** Reads `agentId`'s Skills now, keeping the answer. */
  read(agentId: string): Promise<readonly string[]>;
  /** Reads `agentId`'s Skills unless they are kept or already being read. */
  ensure(agentId: string): void;
  /** Forgets `agentId`'s Skills (after an install), so the next look reads them again. */
  forget(agentId: string): void;
  subscribe(listener: () => void): () => void;
}

export function agentSkills(host: Pick<HostApi, "agentSkills">): AgentSkills {
  const kept = new Map<string, readonly string[]>();
  const reading = new Map<string, Promise<readonly string[]>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const read = (agentId: string): Promise<readonly string[]> => {
    const pending = host.agentSkills(agentId).then(
      (res) => {
        const names = res.skills.map((skill) => skill.name);
        if (reading.get(agentId) === pending) {
          reading.delete(agentId);
          kept.set(agentId, names);
          notify();
        }
        return names;
      },
      (error: unknown) => {
        if (reading.get(agentId) === pending) reading.delete(agentId);
        throw error;
      },
    );
    reading.set(agentId, pending);
    return pending;
  };
  return {
    known: (agentId) => kept.get(agentId),
    read,
    ensure(agentId) {
      if (kept.has(agentId) || reading.has(agentId)) return;
      read(agentId).catch(() => {
        // Unknown: a form warns of nothing, and Start reads again.
      });
    },
    forget(agentId) {
      kept.delete(agentId);
      reading.delete(agentId);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The Skills of `agentId` once read (undefined before, and for no Agent); a first look reads them. */
export function useAgentSkills(
  store: AgentSkills,
  agentId: string | null,
): readonly string[] | undefined {
  const known = useSyncExternalStore(
    store.subscribe,
    () => (agentId === null ? undefined : store.known(agentId)),
    () => undefined,
  );
  useEffect(() => {
    if (agentId !== null) store.ensure(agentId);
  }, [store, agentId, known]);
  return known;
}
