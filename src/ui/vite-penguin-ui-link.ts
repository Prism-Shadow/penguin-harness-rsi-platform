/**
 * How the UI package is bundled into the frame, as two build plugins (`penguinUi()`):
 *
 * - The built page's stylesheet `<link>` carries `data-penguin-ui`. The stylesheet holds the UI
 *   package's compiled CSS (imported first in main.tsx) with the page's own utilities after it;
 *   the attribute is how the host knows the page brings the components' stylesheet, so it writes
 *   in the theme's tokens and fonts but no base stylesheet of its own.
 * - The package's code-highlighting languages (`@shikijs/langs/*`) are left out. They are loaded
 *   only by a code highlighter, which the page never mounts, yet the package's language table
 *   names every one of them, so the bundle would otherwise carry each as a chunk of its own.
 */
import type { Plugin } from "vite";

export const PENGUIN_UI_ATTR = "data-penguin-ui";

/** Adds the attribute to every stylesheet link of the built HTML that does not carry it yet. */
export function markStylesheetLinks(html: string): string {
  return html.replace(/<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/g, (whole, attrs: string) =>
    attrs.includes(PENGUIN_UI_ATTR) ? whole : `<link ${PENGUIN_UI_ATTR}${attrs}>`,
  );
}

const SHIKI_LANGUAGE = /^@shikijs\/langs\//;
/** The one empty module every language import resolves to. */
const NO_LANGUAGE = "\0penguin-ui-no-language";

export function penguinUi(): Plugin[] {
  return [
    {
      name: "penguin-ui-link",
      apply: "build",
      transformIndexHtml: { order: "post", handler: (html) => markStylesheetLinks(html) },
    },
    {
      name: "penguin-ui-no-highlight-languages",
      apply: "build",
      enforce: "pre",
      resolveId: (id) => (SHIKI_LANGUAGE.test(id) ? NO_LANGUAGE : null),
      load: (id) => (id === NO_LANGUAGE ? "export default [];" : null),
    },
  ];
}
