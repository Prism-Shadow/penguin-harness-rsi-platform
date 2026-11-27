/**
 * How the page's Markdown draws fenced code: every fence as a code block, a ```mermaid one
 * included. The UI package draws a mermaid fence as a diagram and loads Mermaid for it, which is
 * larger than this whole page; a case README is read for its text, so the page takes the source
 * as code instead, and the build leaves Mermaid out (vite-penguin-ui-link.ts). A math fence is
 * KaTeX's, as in the package's own adapter.
 */
import { isValidElement, type ReactNode } from "react";
import { CodeBlock, type MdExtensions } from "@prismshadow/penguin-ui";

/** A code element's children as plain text (a string or a list of strings in practice). */
function codeText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
  return "";
}

/** The `<pre><code class="language-x">` pair react-markdown emits, as a code block. */
export function CasePre({ children }: { children?: ReactNode }) {
  if (!isValidElement(children)) return <pre>{children}</pre>;
  const props = children.props as { className?: string; children?: unknown };
  const language = /language-([\w+-]+)/.exec(props.className ?? "")?.[1] ?? "";
  if (language === "math") return <pre>{children}</pre>;
  return <CodeBlock language={language} code={codeText(props.children).replace(/\n$/, "")} />;
}

/** The page-wide Markdown extension: no remark passes, the fenced-code adapter above. */
export const CASE_MARKDOWN: MdExtensions = {
  plugins: [],
  components: { pre: (props) => <CasePre>{props.children}</CasePre> },
};
