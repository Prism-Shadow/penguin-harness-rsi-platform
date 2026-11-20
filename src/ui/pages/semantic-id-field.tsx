/**
 * The Benchmark id field of the manual form: the id is required and validated by the form, but it
 * need not be invented — the button beside the box asks the host to propose one from the title
 * (`POST /api/projects/:p/suggest-id`, kind `benchmark`, the ids already taken), and the proposal
 * replaces what is in the box. It always answers with an id: one transliterated from the title gets
 * a quiet note, a placeholder an attention note asking for a real name. Typing a title never
 * rewrites the id. The button sits beside the box, outside its label, so the label names the input.
 */
import { useId, useState } from "react";
import {
  Button,
  FieldError,
  FieldHint,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
} from "@prismshadow/penguin-ui";
import type { SuggestIdResponse } from "../api";
import { useStrings, useWorkbench } from "../context";
import type { Strings } from "../strings";
import { errorText } from "./failure";

interface Notice {
  tone: "attention" | "muted";
  text: string;
}

/** What the field says about the id a proposal just filled in; null when the id speaks for itself. */
export function idSuggestNotice(res: SuggestIdResponse, s: Strings): Notice | null {
  const words = s.semanticId.idSuggest;
  if (res.source === "placeholder") {
    const why =
      (res.reason !== undefined ? words.reasons[res.reason] : undefined) ?? words.reasonUnknown;
    return { tone: "attention", text: words.placeholder(why) };
  }
  if (res.source === "fallback") return { tone: "muted", text: words.fromName };
  return null;
}

export function SemanticIdField({
  label,
  hint,
  generateHint,
  value,
  source,
  taken,
  error,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  /** The generation clause appended to `hint`. */
  generateHint: string;
  value: string;
  /** The text a proposal is derived from: the title, or the description while it is empty. */
  source: string;
  taken: readonly string[];
  error?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const controlId = useId();
  const messageId = `${controlId}-message`;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const derivable = source.trim() !== "";

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await wb.api.suggestId({
        name: source.trim(),
        kind: "benchmark",
        ...(taken.length > 0 ? { taken: [...taken] } : {}),
      });
      onChange(res.id);
      setNotice(idSuggestNotice(res, s));
    } catch (e) {
      // The id is unchanged; what went wrong is said where the note would be.
      setNotice({ tone: "attention", text: errorText(e, s) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <FieldLabel htmlFor={controlId} required>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={controlId}
          size="sm"
          required
          value={value}
          invalid={error !== undefined}
          className="min-w-0 flex-1 font-mono"
          disabled={disabled}
          {...(error !== undefined || notice !== null ? { "aria-describedby": messageId } : {})}
          onChange={(e) => {
            setNotice(null);
            onChange(e.target.value);
          }}
        />
        <Button
          size="sm"
          title={s.semanticId.generateId}
          loading={busy}
          disabled={disabled || !derivable}
          onClick={() => void generate()}
          className="shrink-0 whitespace-nowrap"
          leading={<GlyphIcon d={ICONS.sparkles} size={ICON_SIZE.inlineGlyph} />}
        >
          {s.semanticId.generateIdLabel}
        </Button>
      </div>
      {error !== undefined ? (
        <FieldError id={messageId}>{error}</FieldError>
      ) : notice?.tone === "attention" ? (
        <span id={messageId} role="status" className="mt-1 block text-xs text-tone-attention-fg">
          {notice.text}
        </span>
      ) : (
        <>
          <FieldHint>{`${hint}${generateHint}`}</FieldHint>
          {notice !== null && (
            <span id={messageId} role="status" className="mt-1 block text-xs text-fg-subtle">
              {notice.text}
            </span>
          )}
        </>
      )}
    </div>
  );
}
