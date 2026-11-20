/**
 * What the host writes on the frame's root element beside the theme, read live: `lang` (the
 * interface language, `zh-CN` or `en`) and `data-project-id` (the current Project). Both change
 * while the page runs — the viewer switches language or Project — so a MutationObserver follows
 * them, and a change re-renders the page.
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en";

export interface FrameFacts {
  locale: Locale;
  /** Null until the host has written one: the page shows nothing until then. */
  projectId: string | null;
}

export const PROJECT_ATTR = "data-project-id";

/** The Chinese table for any `zh…` tag; English for everything else. */
export function localeOf(lang: string | null): Locale {
  return lang !== null && lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let last: FrameFacts | null = null;

function snapshot(): FrameFacts {
  const root = document.documentElement;
  const locale = localeOf(root.getAttribute("lang"));
  const raw = root.getAttribute(PROJECT_ATTR);
  const projectId = raw === null || raw === "" ? null : raw;
  // The same facts are the same object, as useSyncExternalStore requires.
  if (last === null || last.locale !== locale || last.projectId !== projectId) {
    last = { locale, projectId };
  }
  return last;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang", PROJECT_ATTR],
  });
  return () => observer.disconnect();
}

export function useFrameFacts(): FrameFacts {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
