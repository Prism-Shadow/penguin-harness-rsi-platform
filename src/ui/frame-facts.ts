/**
 * What the page knows without being told, read from where it is:
 *
 * - **Its address.** The page is the workbench's `ui/index.html`, served at
 *   `<apiBase>/projects/<projectId>/agents/<agentId>/workbenches/<workbenchId>/ui/…`. The part
 *   before `/projects/…` is the API of the server that holds the workbench — `/api`, or
 *   `/server/<machineId>/api` behind the host's machine proxy, or whatever a reverse proxy put in
 *   front of either — the page SDK's `apiBase` rule (the host's workbenches/page-sdk.ts). The
 *   Project and the Agent the workbench is installed on come from the same path.
 * - **The interface language.** The host writes `lang` on the frame's root element; a host that
 *   does not is read through the parent document's own `lang` (same origin). Both are followed
 *   live, so switching the language re-renders the page.
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en";

/** Where the page is served from, and whose workbench it is. */
export interface PageAddress {
  /** The API of the server holding the workbench: `/api`, or `/server/<machineId>/api`. */
  apiBase: string;
  projectId: string;
  /** The Agent the workbench is installed on: whose Benchmarks these are. */
  agentId: string;
  /** The workbench's id on that Agent: its folder's name (`benchmark`). */
  workbenchId: string;
}

const MOUNT = /\/projects\/([^/]+)\/agents\/([^/]+)\/workbenches\/([^/]+)\/ui(?:\/|$)/;

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The address a page path names, or null for a path that is not a workbench page's. */
export function pageAddressOf(pathname: string): PageAddress | null {
  const match = MOUNT.exec(pathname);
  if (match === null) return null;
  const [projectId, agentId, workbenchId] = [match[1]!, match[2]!, match[3]!].map(decoded);
  if (projectId == null || agentId == null || workbenchId == null) return null;
  return { apiBase: pathname.slice(0, match.index), projectId, agentId, workbenchId };
}

/** The Chinese table for any `zh…` tag; English for everything else. */
export function localeOf(lang: string | null): Locale {
  return lang !== null && lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** The parent document's root, when the page is framed by a document it may read. */
function parentRoot(): HTMLElement | null {
  try {
    return window.parent !== window ? window.parent.document.documentElement : null;
  } catch {
    // A frame of another origin: its language is not ours to read.
    return null;
  }
}

/** The language the host gave the page: the frame root's `lang`, else the parent's. */
function currentLang(): string | null {
  const own = document.documentElement.getAttribute("lang");
  if (own !== null && own !== "") return own;
  return parentRoot()?.getAttribute("lang") ?? null;
}

function snapshot(): Locale {
  return localeOf(currentLang());
}

function subscribe(onChange: () => void): () => void {
  const observers = [document.documentElement, parentRoot()]
    .filter((root): root is HTMLElement => root !== null)
    .map((root) => {
      const observer = new MutationObserver(onChange);
      observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
      return observer;
    });
  return () => observers.forEach((observer) => observer.disconnect());
}

/** The interface language, followed live. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
