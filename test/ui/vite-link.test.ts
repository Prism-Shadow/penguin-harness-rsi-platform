/**
 * How the UI package goes into the built page.
 *
 * - Given the built HTML, every stylesheet link carries `data-penguin-ui`, so the host writes the
 *   theme in without a base stylesheet of its own; marking it twice changes nothing, and a link
 *   that is not a stylesheet is left alone.
 * - Given an import of Mermaid, or of one of its files, the build resolves it to one module that
 *   imports nothing, under a name that does not say mermaid; the highlighter's languages resolve to
 *   one such module too. Every other import is left to Vite.
 */
import { describe, expect, it } from "vitest";
import { markStylesheetLinks, penguinUi } from "../../src/ui/vite-penguin-ui-link";

const BUILT = [
  "<head>",
  '<script type="module" crossorigin src="./assets/index-a.js"></script>',
  '<link rel="stylesheet" crossorigin href="./assets/index-b.css">',
  '<link rel="icon" href="./icon.svg">',
  "</head>",
].join("\n");

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** A plugin hook as a function, whether it is given bare or as `{ handler }`. */
const asFunction = (hook: unknown): Hook | undefined =>
  typeof hook === "function" ? (hook as Hook) : (hook as { handler?: Hook } | undefined)?.handler;

/** What the build plugins resolve `id` to, or null when they leave it to Vite. */
function resolve(id: string): string | null {
  for (const plugin of penguinUi()) {
    const resolved = asFunction(plugin.resolveId)?.call({}, id, undefined, {});
    if (typeof resolved === "string") return resolved;
  }
  return null;
}

/** The code the build plugins load for a resolved `id`. */
function load(id: string): string | null {
  for (const plugin of penguinUi()) {
    const code = asFunction(plugin.load)?.call({}, id);
    if (typeof code === "string") return code;
  }
  return null;
}

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

describe("what the build leaves out", () => {
  it("takes every import of Mermaid as one module that imports nothing and does not say mermaid", () => {
    const stub = resolve("mermaid");

    expect(stub).not.toBeNull();
    expect(resolve("mermaid/dist/mermaid.core.mjs")).toBe(stub);
    expect(stub).not.toMatch(/mermaid/i);
    expect(load(stub!)).not.toMatch(/\bimport\b/);
  });

  it("takes the highlighter's languages as one module that imports nothing", () => {
    const stub = resolve("@shikijs/langs/python");

    expect(stub).not.toBeNull();
    expect(resolve("@shikijs/langs/typescript")).toBe(stub);
    expect(load(stub!)).not.toMatch(/\bimport\b/);
  });

  it("leaves every other import to Vite", () => {
    for (const id of ["react", "mermaidjs-lookalike", "@shikijs/core", "./case-markdown"]) {
      expect(resolve(id)).toBeNull();
    }
  });
});
