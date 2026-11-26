/**
 * Where each server's copies of this workbench's Benchmarks are read from: this server's handler,
 * and for an admin each machine's, through the host's machine proxy (`/server/<machineId>/api/…`).
 *
 * A machine carries the same Agent's workbench when its App Center lists a workbench of that Agent
 * installed from this plugin (the tile's `plugin`); its handler answers the same routes as this
 * one. A machine without one is read at its older Project route, `/api/projects/<p>/benchmarks`,
 * which a 0.2.19 server answers with the same JSON (`?local=1`). That fallback is compatibility
 * code for machines that have not upgraded yet: remove it at 1.0.
 *
 * Each machine is looked up once per page and remembered; a lookup that fails is forgotten, so the
 * next read asks again.
 */
import {
  benchmarksApi,
  machineApiBase,
  machineAppCenter,
  workbenchBase,
  type BenchmarksApi,
} from "./api";
import type { PageAddress } from "./frame-facts";
import { WORKBENCH_PLUGIN } from "./methods";

export interface SourceResolver {
  /** The Benchmark routes of `machineId` (null: this server). */
  resolve(machineId: string | null): Promise<BenchmarksApi>;
  /** The same, once a lookup has answered; null before (URLs a browser follows are built from it). */
  resolved(machineId: string | null): BenchmarksApi | null;
}

const enc = encodeURIComponent;

export function sourceResolver(address: PageAddress, local: BenchmarksApi): SourceResolver {
  const lookups = new Map<string, Promise<BenchmarksApi>>();
  const answers = new Map<string, BenchmarksApi>();
  const lookup = async (machineId: string): Promise<BenchmarksApi> => {
    const api = machineApiBase(address.apiBase, machineId);
    const tiles = (await machineAppCenter(api, address.projectId)).filter(
      (tile) => tile.agentId === address.agentId && tile.plugin === WORKBENCH_PLUGIN,
    );
    const tile = tiles.find((t) => t.workbenchId === address.workbenchId) ?? tiles[0];
    if (tile !== undefined) {
      return benchmarksApi(
        `${workbenchBase(api, address.projectId, address.agentId, tile.workbenchId)}/benchmarks`,
      );
    }
    // Compatibility, remove at 1.0: a machine still on 0.2.19 serves its own copies there.
    return benchmarksApi(`${api}/projects/${enc(address.projectId)}/benchmarks`, true);
  };
  return {
    resolve(machineId) {
      if (machineId === null) return Promise.resolve(local);
      let pending = lookups.get(machineId);
      if (pending === undefined) {
        pending = lookup(machineId).then(
          (found) => {
            answers.set(machineId, found);
            return found;
          },
          (error: unknown) => {
            lookups.delete(machineId);
            throw error;
          },
        );
        lookups.set(machineId, pending);
      }
      return pending;
    },
    resolved(machineId) {
      return machineId === null ? local : (answers.get(machineId) ?? null);
    },
  };
}
