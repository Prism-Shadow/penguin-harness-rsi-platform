/**
 * How a request that went wrong is said on the page: its words beside an alert glyph, in the body
 * ink — the glyph carries the tone, so nothing reads as red alarm text. The words are the strings
 * table's for a code it knows, else the server's own message, else the generic line.
 */
import type { ReactNode } from "react";
import { GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { ApiError } from "../api";
import type { Strings } from "../strings";

/** The words for a failed request. */
export function errorText(err: unknown, s: Strings): string {
  if (!(err instanceof ApiError)) return s.common.unknownError;
  if (err.code === "network_error") return s.common.networkError;
  const known = s.errors.byCode[err.code];
  if (known !== undefined) return known;
  return err.message !== "" ? err.message : s.common.unknownError;
}

export function FailureLine({
  text,
  action,
  className = "",
}: {
  text: string;
  /** A way out beside the words (a retry). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <p className={`flex items-start gap-1.5 text-xs text-fg-muted ${className}`}>
      <span className="mt-px shrink-0 text-tone-danger-fg" aria-hidden>
        <GlyphIcon d={ICONS.alertCircle} size={ICON_SIZE.inlineGlyph} />
      </span>
      <span className="min-w-0 break-words">{text}</span>
      {action}
    </p>
  );
}
