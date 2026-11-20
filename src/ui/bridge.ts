/**
 * The two messages the page and the App Center's window exchange (`postMessage`, same origin):
 *
 * - `{ type: "penguin:location", at }`, both ways. The page posts it on every move inside itself,
 *   after replacing its own history entry; the host posts it when its address moved on its own
 *   (Back, Forward, a pasted address), and the page goes there without reloading.
 * - `{ type: "penguin:navigate", to }`, from the page: take the viewer to `to`, a path of the Web
 *   App such as a conversation. The host minimizes the window first.
 *
 * A message counts only from `window.parent` on this origin; the page posts only to its own origin.
 * Outside a frame there is no host, and nothing is posted or taken.
 */

export const LOCATION_MESSAGE = "penguin:location";
export const NAVIGATE_MESSAGE = "penguin:navigate";

/** A location an address should carry: a path starting with "/", not "//", and not too long. */
const MAX_AT = 2048;

/** The host window, or null when the page is not framed. */
function host(): Window | null {
  return window.parent !== window ? window.parent : null;
}

function post(message: { type: string; at?: string; to?: string }): void {
  try {
    host()?.postMessage(message, window.location.origin);
  } catch {
    // The host is gone; there is nobody to tell.
  }
}

/** Tells the host where the page now is. */
export function postLocation(at: string): void {
  post({ type: LOCATION_MESSAGE, at });
}

/** Asks the host to take the viewer to `to`, a path of the Web App. */
export function postNavigate(to: string): void {
  post({ type: NAVIGATE_MESSAGE, to });
}

/** A location inside the page, or null for anything that is not one. */
export function innerLocationOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw.length > MAX_AT ? null : raw;
}

/** The location a host message names, or null when the event is not one from the host. */
export function hostLocationOf(
  event: Pick<MessageEvent, "data" | "origin" | "source">,
): string | null {
  const parent = host();
  if (parent === null || event.source !== parent) return null;
  if (event.origin !== window.location.origin) return null;
  const data = event.data as { type?: unknown; at?: unknown } | null;
  if (data === null || typeof data !== "object" || data.type !== LOCATION_MESSAGE) return null;
  return innerLocationOf(data.at);
}

/** Calls `onLocation` for every location the host sends; returns the function that stops it. */
export function listenToHost(onLocation: (at: string) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    const at = hostLocationOf(event);
    if (at !== null) onLocation(at);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Where the host asked the page to start: the document's fragment (`#<at>`), else the list. */
export function initialAt(): string {
  const hash = window.location.hash;
  return innerLocationOf(hash.startsWith("#") ? hash.slice(1) : "") ?? "/";
}

/** Keeps the page's own address on `at` without adding a history entry. */
export function replaceAt(at: string): void {
  try {
    window.history.replaceState(window.history.state, "", `#${at}`);
  } catch {
    // A document that cannot rewrite its address still moves; the host keeps the location.
  }
}
