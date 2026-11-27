/**
 * The two messages the page and the App Center's window exchange (`postMessage`, same origin):
 *
 * - `{ type: "penguin:location", at }`, both ways. The page posts it on every move inside itself,
 *   after replacing its own history entry; the host posts it when its address moved on its own
 *   (Back, Forward, a pasted address), and the page goes there without reloading.
 * - `{ type: "penguin:navigate", to }`, from the page: take the viewer to `to`, a path of the Web
 *   App such as a conversation. The host minimizes the window first. A host that predates the
 *   message answers nothing: when the page is still shown a moment later, it takes the whole
 *   tab there itself (`openInHost`). An older host keeps no inner location either, and the page
 *   moves inside itself all the same.
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

/**
 * Whether the page can be seen: its document is visible and, framed, the frame is not hidden. A
 * minimized App Center window keeps its frame mounted and laid out with `visibility: hidden`,
 * which the frame's own document does not report; the frame element (same origin) does.
 */
export function pageShown(): boolean {
  if (document.visibilityState !== "visible") return false;
  try {
    const frame = window.frameElement;
    const view = frame?.ownerDocument.defaultView;
    if (frame && view && view.getComputedStyle(frame).visibility === "hidden") return false;
  } catch {
    // A frame of another origin: the document's own visibility is all there is to go on.
  }
  return true;
}

/** How long the host has to take the viewer away before the page does it itself. */
export const NAVIGATE_FALLBACK_MS = 800;

/**
 * Takes the viewer to `to`, a path of the Web App: asks the host (`penguin:navigate`), which
 * minimizes the window and goes there; when the page is still shown after
 * {@link NAVIGATE_FALLBACK_MS} — a host that predates the message, or no host at all — the top
 * window goes there instead.
 */
export function openInHost(to: string): void {
  postNavigate(to);
  window.setTimeout(() => {
    if (!pageShown()) return;
    try {
      (window.top ?? window).location.assign(to);
    } catch {
      window.location.assign(to);
    }
  }, NAVIGATE_FALLBACK_MS);
}
