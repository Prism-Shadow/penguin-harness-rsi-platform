/**
 * The page's own routes, over the location the host keeps in the window's `at`:
 *
 * - `/` — the list;
 * - `/<benchmarkId>` — one Benchmark;
 * - `?agentId=<id>` on either — the list narrowed to the Benchmarks that tested that Agent (kept
 *   while a Benchmark is open, so the way back returns to the same list).
 *
 * Every move replaces the page's history entry and tells the host (bridge.ts); a location the host
 * sends moves the page without telling it back.
 */
import { useCallback, useEffect, useState } from "react";
import { initialAt, listenToHost, postLocation, replaceAt } from "./bridge";

export interface Route {
  benchmarkId: string | null;
  agentId: string | null;
}

/** Resolves a relative location; the host never reaches past it. */
const BASE = "http://frame.invalid";

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The route a location names; anything unreadable is the list. */
export function parseAt(at: string): Route {
  let url: URL;
  try {
    url = new URL(at, BASE);
  } catch {
    return { benchmarkId: null, agentId: null };
  }
  const segments = url.pathname.split("/").filter((s) => s !== "");
  const benchmarkId = segments.length === 1 ? decoded(segments[0]!) : null;
  const agentId = url.searchParams.get("agentId");
  return { benchmarkId, agentId: agentId === null || agentId === "" ? null : agentId };
}

/** The location of a route. */
export function formatAt(route: Route): string {
  const path = route.benchmarkId === null ? "/" : `/${encodeURIComponent(route.benchmarkId)}`;
  return route.agentId === null ? path : `${path}?agentId=${encodeURIComponent(route.agentId)}`;
}

export interface InnerLocation {
  route: Route;
  /** Moves the page: its address is replaced and the host is told. */
  go: (route: Route) => void;
}

/** Where the page is: the fragment it was loaded with, then its own moves and the host's. */
export function useInnerLocation(): InnerLocation {
  const [at, setAt] = useState(initialAt);
  useEffect(
    () =>
      listenToHost((next) => {
        replaceAt(next);
        setAt(next);
      }),
    [],
  );
  const go = useCallback((route: Route) => {
    const next = formatAt(route);
    replaceAt(next);
    setAt(next);
    postLocation(next);
  }, []);
  return { route: parseAt(at), go };
}
