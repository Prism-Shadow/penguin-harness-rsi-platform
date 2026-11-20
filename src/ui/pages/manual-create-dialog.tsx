/**
 * The manual New Benchmark form (owner only): title, id, description, runs per case and a list of
 * cases, each a statement and a rubric. No Agent is chosen here — a Benchmark belongs to the
 * Project and records the Agent it tested on each evaluation instead. The server writes the
 * layout. Format hints stay visible while typing; the semantics sit behind the "?" marks.
 *
 * Create is live once every required field of the form and of each case is filled and nothing is
 * malformed — a malformed id or run count is said under its field as it is typed. Closing the form
 * with anything typed asks first; nothing closes it while the write is in flight.
 */
import { useRef, useState } from "react";
import {
  Button,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  InfoPopover,
  Input,
  Modal,
  PlusIcon,
  Textarea,
  discardUnsaved,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import type { BenchmarkSummary } from "../../api";
import { ApiError } from "../api";
import { useStrings, useWorkbench } from "../context";
import type { Strings } from "../strings";
import { FailureLine, errorText } from "./failure";
import { SemanticIdField } from "./semantic-id-field";

/** Directory names and Benchmark ids share the Agent id alphabet. */
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Runs per case, as the create route bounds them. */
export const MAX_RUNS = 1000;

/** A digits-only runs field within [1, MAX_RUNS]. */
export function isValidRuns(raw: string): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const n = Number.parseInt(raw, 10);
  return n >= 1 && n <= MAX_RUNS;
}

/** `CASE-NNN-<slug>`: the case directory name from its 1-based position and slug. */
export function caseId(index: number, slug: string): string {
  return `CASE-${String(index).padStart(3, "0")}-${slug}`;
}

interface CaseDraft {
  /** Stable React key, independent of position, so removing a case keeps the others' state. */
  key: number;
  slug: string;
  title: string;
  statement: string;
  rubric: string;
}

type CaseErrors = Partial<Record<"slug" | "title" | "statement" | "rubric", string>>;

interface FormErrors {
  id?: string;
  title?: string;
  runs?: string;
  /** Keyed by CaseDraft.key: removing a case must not move another one's errors onto it. */
  cases: Record<number, CaseErrors>;
}

interface BenchmarkDraft {
  title: string;
  id: string;
  description: string;
  runs: string;
  cases: CaseDraft[];
}

const digits = (v: string) => v.replace(/[^\d]/g, "");
const errorProp = (message: string | undefined) =>
  message !== undefined ? { error: message } : {};

/** A draft as a create compares it: text trimmed, the cases without their React keys. */
const normalizedDraft = (d: BenchmarkDraft) => ({
  title: d.title.trim(),
  id: d.id.trim(),
  description: d.description.trim(),
  runs: d.runs,
  cases: d.cases.map((c) => ({
    slug: c.slug.trim(),
    title: c.title.trim(),
    statement: c.statement.trim(),
    rubric: c.rubric.trim(),
  })),
});

function validateDraft(d: BenchmarkDraft, s: Strings): FormErrors {
  const next: FormErrors = { cases: {} };
  if (d.title.trim() === "") next.title = s.common.requiredField;
  if (d.id.trim() === "") next.id = s.common.requiredField;
  else if (!ID_PATTERN.test(d.id.trim())) next.id = s.benchmark.invalidId;
  if (!isValidRuns(d.runs)) next.runs = s.benchmark.invalidRuns;
  for (const c of d.cases) {
    const e: CaseErrors = {};
    if (c.slug.trim() === "") e.slug = s.common.requiredField;
    else if (!ID_PATTERN.test(c.slug.trim())) e.slug = s.benchmark.invalidId;
    if (c.title.trim() === "") e.title = s.common.requiredField;
    if (c.statement.trim() === "") e.statement = s.common.requiredField;
    if (c.rubric.trim() === "") e.rubric = s.common.requiredField;
    next.cases[c.key] = e;
  }
  return next;
}

export function ManualCreateDialog({
  takenIds,
  onClose,
  onCreated,
}: {
  takenIds: readonly string[];
  onClose: () => void;
  onCreated: (benchmark: BenchmarkSummary) => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const keyRef = useRef(0);
  const newCase = (): CaseDraft => ({
    key: keyRef.current++,
    slug: "",
    title: "",
    statement: "",
    rubric: "",
  });
  const [opening] = useState<BenchmarkDraft>(() => ({
    title: "",
    id: "",
    description: "",
    runs: "1",
    cases: [newCase()],
  }));
  const form = useFormDraft(opening, { normalize: normalizedDraft });
  const { title, id, description, runs, cases } = form.draft;
  /** The id the server refused as taken; cleared by the next edit of the id. */
  const [idTaken, setIdTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  // An empty required field has its asterisk; only a malformed value is said under it.
  const shownError = (message: string | undefined) =>
    message === s.common.requiredField ? undefined : message;

  const updateCase = (key: number, patch: Partial<CaseDraft>) =>
    form.setDraft((prev) => ({
      ...prev,
      cases: prev.cases.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  const setCases = (next: (prev: CaseDraft[]) => CaseDraft[]) =>
    form.setDraft((prev) => ({ ...prev, cases: next(prev.cases) }));

  const errors = validateDraft(form.draft, s);
  const valid =
    errors.id === undefined &&
    errors.title === undefined &&
    errors.runs === undefined &&
    Object.values(errors.cases).every((c) => Object.keys(c).length === 0);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const trimmedDescription = description.trim();
      const res = await wb.api.createBenchmark({
        id: id.trim(),
        title: title.trim(),
        ...(trimmedDescription !== "" ? { description: trimmedDescription } : {}),
        runs: Number.parseInt(runs, 10),
        cases: cases.map((c, i) => ({
          id: caseId(i + 1, c.slug.trim()),
          title: c.title.trim(),
          statement: c.statement,
          rubric: c.rubric,
        })),
      });
      toastSuccess(s.benchmark.created);
      discardUnsaved(form.scope);
      onCreated(res.benchmark);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setIdTaken(true);
      else setSubmitError(errorText(e, s));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={s.benchmark.manualCreateTitle}
      onClose={requestClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {s.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {busy ? s.common.saving : s.benchmark.createSubmit}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{s.benchmark.manualCreateIntro}</p>
        <Input
          label={s.benchmark.titleField}
          required
          value={title}
          onChange={(e) => form.patch({ title: e.target.value })}
          {...errorProp(shownError(errors.title))}
        />
        <SemanticIdField
          label={s.benchmark.idField}
          hint={s.benchmark.idHint}
          generateHint={s.benchmark.idGenerateHint}
          value={id}
          source={title.trim() || description}
          taken={takenIds}
          {...(idTaken
            ? { error: s.benchmark.idExists }
            : shownError(errors.id) !== undefined
              ? { error: shownError(errors.id) }
              : {})}
          disabled={busy}
          onChange={(next) => {
            form.patch({ id: next });
            setIdTaken(false);
          }}
        />
        <Textarea
          label={s.benchmark.descriptionField}
          hint={s.benchmark.descriptionHint}
          rows={2}
          value={description}
          onChange={(e) => form.patch({ description: e.target.value })}
        />
        <Input
          label={s.benchmark.runsField}
          hint={s.benchmark.runsHint}
          info={s.benchmark.runsInfo}
          infoLabel={s.benchmark.runsField}
          inputMode="numeric"
          value={runs}
          onChange={(e) => form.patch({ runs: digits(e.target.value) })}
          {...errorProp(shownError(errors.runs))}
        />

        <div>
          <div className="mb-2 flex items-center gap-1">
            <FieldLabel block={false}>{s.benchmark.casesTitle}</FieldLabel>
            <InfoPopover label={s.benchmark.casesTitle}>{s.benchmark.casesInfo}</InfoPopover>
          </div>
          <div className="space-y-3">
            {cases.map((c, i) => {
              const e = errors.cases[c.key] ?? {};
              const dirName = caseId(i + 1, c.slug.trim() || "<slug>");
              return (
                <div key={c.key} className="border-t border-line pt-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-fg">
                      {s.benchmark.caseHeading(i + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle">
                      {dirName}
                    </span>
                    {cases.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={s.benchmark.removeCase}
                        aria-label={s.benchmark.removeCase}
                        onClick={() => setCases((prev) => prev.filter((x) => x.key !== c.key))}
                      >
                        <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      size="sm"
                      label={s.benchmark.caseSlugField}
                      required
                      hint={s.benchmark.caseSlugHint(dirName)}
                      value={c.slug}
                      className="font-mono"
                      onChange={(event) => updateCase(c.key, { slug: event.target.value })}
                      {...errorProp(shownError(e.slug))}
                    />
                    <Input
                      size="sm"
                      label={s.benchmark.caseTitleField}
                      required
                      value={c.title}
                      onChange={(event) => updateCase(c.key, { title: event.target.value })}
                      {...errorProp(shownError(e.title))}
                    />
                  </div>
                  <div className="mt-3">
                    <Textarea
                      size="sm"
                      label={s.benchmark.caseStatementField}
                      required
                      hint={s.benchmark.caseStatementHint}
                      rows={4}
                      value={c.statement}
                      onChange={(event) => updateCase(c.key, { statement: event.target.value })}
                      {...errorProp(shownError(e.statement))}
                    />
                  </div>
                  <div className="mt-3">
                    <Textarea
                      size="sm"
                      label={s.benchmark.caseRubricField}
                      required
                      hint={s.benchmark.caseRubricHint}
                      info={s.benchmark.rubricInfo}
                      infoLabel={s.benchmark.caseRubricField}
                      rows={4}
                      value={c.rubric}
                      onChange={(event) => updateCase(c.key, { rubric: event.target.value })}
                      {...errorProp(shownError(e.rubric))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setCases((prev) => [...prev, newCase()])}
          >
            <PlusIcon />
            {s.benchmark.addCase}
          </Button>
        </div>
        {submitError !== null && <FailureLine text={submitError} />}
      </div>
    </Modal>
  );
}
