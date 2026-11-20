/**
 * The built page's stylesheet link, as the host reads it.
 *
 * - Given the built HTML, every stylesheet link carries `data-penguin-ui`, so the host writes the
 *   theme in without a base stylesheet of its own; marking it twice changes nothing, and a link
 *   that is not a stylesheet is left alone.
 */
import { describe, expect, it } from "vitest";
import { markStylesheetLinks } from "../../src/ui/vite-penguin-ui-link";

const BUILT = [
  "<head>",
  '<script type="module" crossorigin src="./assets/index-a.js"></script>',
  '<link rel="stylesheet" crossorigin href="./assets/index-b.css">',
  '<link rel="icon" href="./icon.svg">',
  "</head>",
].join("\n");

describe("the built page's stylesheet link", () => {
  it("carries data-penguin-ui once, and other links are left alone", () => {
    const marked = markStylesheetLinks(BUILT);

    expect(marked).toContain(
      '<link data-penguin-ui rel="stylesheet" crossorigin href="./assets/index-b.css">',
    );
    expect(marked).toContain('<link rel="icon" href="./icon.svg">');
    expect(markStylesheetLinks(marked)).toBe(marked);
  });
});
