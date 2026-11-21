/**
 * One evaluation, in a dialog of its own: the series its score belongs to, the Agent State version
 * it tested, the three stored metrics, the evaluation's own summary, and the per-case scores with
 * the raw result of every Run. Nothing is recomputed: every number is the one the scoreboard
 * stores. A Run in a Session opens that conversation — archived or not, it opens by its address —
 * once the server holding it confirms it still exists; a Run recorded as a Harbor trial is no
 * Session, so it offers the trial's name to copy instead. The footer asks the Project's default
 * agent about the result (Ask AI), since the explanation lives in the Traces.
 */
import { useState } from "react";
import {
  Button,
  Chevron,
  CopyButton,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Modal,
} from "@prismshadow/penguin-ui";
import type { AskEvaluationFacts, BenchmarkCaseScore, MergedEvaluation } from "../../api";
import { ApiError, getSession } from "../api";
import { useStrings, useWorkbench } from "../context";
import {
  formatDateTime,
  formatMoney,
  formatScore,
  humanizeDuration,
  type Currency,
} from "../format";
import { evaluationLabel } from "../metrics";
import { AgentPicture } from "./agent-picture";
import { AskDialog } from "./ask-dialog";
import { FailureLine, errorText } from "./failure";

/** How agent-evaluation records a Harbor trial in a run's `session_id`: it is no Session. */
const TRIAL_PREFIX = "harbor:";

/** The trial a run's id names, or null for a Session id. */
export function harborTrialName(sessionId: string): string | null {
  return sessionId.startsWith(TRIAL_PREFIX) ? sessionId.slice(TRIAL_PREFIX.length) : null;
}

/** A run's label, "Run #N": a link to its Session, text with a copy button for a trial, else text. */
export function RunLabel({
  index,
  sessionId,
  onOpen,
}: {
  /** 1-based, as the label reads. */
  index: number;
  sessionId?: string;
  onOpen: (sessionId: string) => void;
}) {
  const s = useStrings();
  const label = `${s.benchmark.colRun} #${index}`;
  if (sessionId === undefined || sessionId === "") return <span>{label}</span>;
  const trial = harborTrialName(sessionId);
  if (trial !== null) {
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        <CopyButton text={trial} label={s.benchmark.copyTrialName} size="sm" className="shrink-0" />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-tooltip={s.benchmark.runOpenSession}
      data-tooltip-extra
      onClick={() => onOpen(sessionId)}
      className="text-link underline-offset-2 transition-colors duration-150 hover:text-link-hover hover:underline"
    >
      {label}
    </button>
  );
}

/** One Case's row: its stored averages; opening it shows each Run's raw result. */
function CaseRow({
  caseScore: c,
  title,
  currency,
  onOpenRun,
}: {
  caseScore: BenchmarkCaseScore;
  title?: string;
  currency: Currency;
  onOpenRun: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-default text-xs transition-colors duration-150 hover:bg-surface-muted"
      >
        <td className="px-2 py-1">
          <span className="flex items-start gap-1.5">
            <Chevron open={open} size={12} className="text-fg-subtle" />
            {/* The case's title; its directory name, the files' id, is the hover hint. */}
            <span
              className="min-w-0 font-medium text-fg"
              {...(title !== undefined && title !== c.case
                ? { "data-tooltip": c.case, "data-tooltip-content": "code" }
                : {})}
            >
              {title ?? c.case}
            </span>
          </span>
        </td>
        <td className="px-2 py-1 font-mono tabular-nums">{formatScore(c.score)}</td>
        <td className="px-2 py-1 font-mono tabular-nums text-fg-muted">
          {formatMoney(c.cost, currency)}
        </td>
        <td className="px-2 py-1 font-mono tabular-nums text-fg-muted">
          {humanizeDuration(c.durationMs)}
        </td>
      </tr>
      {open &&
        c.runs.map((run, i) => (
          <tr key={i} className="text-xs text-fg-muted">
            <td className="py-1 pl-7 pr-2 font-mono">
              <RunLabel
                index={i + 1}
                {...(run.sessionId ? { sessionId: run.sessionId } : {})}
                onOpen={onOpenRun}
              />
            </td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatScore(run.score)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatMoney(run.cost, currency)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{humanizeDuration(run.durationMs)}</td>
          </tr>
        ))}
    </>
  );
}

/** One of the three stored metrics: its name over its value. */
function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="block text-xs text-fg-muted">{label}</span>
      <span
        className={`block font-mono text-xs tabular-nums ${strong ? "font-semibold" : "text-fg-muted"}`}
      >
        {value}
      </span>
    </span>
  );
}

/** The evaluation's facts as the dialog prints them, so the question and the screen agree. */
function askFacts(
  evaluation: MergedEvaluation,
  label: string,
  currency: Currency,
): AskEvaluationFacts {
  return {
    time: formatDateTime(evaluation.time),
    label,
    version: evaluation.version,
    provider: evaluation.provider,
    modelId: evaluation.modelId,
    thinkingLevel: evaluation.thinkingLevel,
    score: formatScore(evaluation.score),
    cost: formatMoney(evaluation.cost, currency),
    duration: humanizeDuration(evaluation.durationMs),
    summaryTitle: evaluation.summaryTitle ?? "",
    summary: evaluation.summary ?? "",
    cases: evaluation.cases.map((c) => ({
      id: c.case,
      score: formatScore(c.score),
      cost: formatMoney(c.cost, currency),
      duration: humanizeDuration(c.durationMs),
      sessionIds: c.runs.map((run) => run.sessionId).filter((id) => id !== ""),
    })),
  };
}

export function EvaluationDialog({
  benchmarkId,
  evaluation,
  caseTitles,
  onClose,
}: {
  benchmarkId: string;
  evaluation: MergedEvaluation;
  caseTitles: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const [asking, setAsking] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const label = evaluationLabel(evaluation);
  const labelText = label.unlabeled ? s.benchmark.unlabeled : label.text;

  /**
   * A run link: the conversation opens once the server holding it says it exists (asked at the
   * click, so the answer is the Session's state now); one that is gone is said under the table.
   */
  const openRun = async (sessionId: string) => {
    setRunError(null);
    try {
      await getSession(sessionId, evaluation.machineId);
      wb.openSession(sessionId);
    } catch (e) {
      setRunError(
        e instanceof ApiError && e.status === 404 ? s.benchmark.runSessionGone : errorText(e, s),
      );
    }
  };

  return (
    <>
      <Modal
        open
        title={s.benchmark.evaluationDetailTitle(formatDateTime(evaluation.time))}
        widthClass="sm:max-w-3xl"
        onClose={onClose}
        footer={
          <>
            <Button size="sm" onClick={onClose}>
              {s.common.close}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAsking(true)}
              leading={<GlyphIcon d={ICONS.wand} size={ICON_SIZE.inlineGlyph} />}
            >
              {s.benchmark.askAi}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
              {evaluation.agentId !== null && evaluation.agentId !== "" && (
                <AgentPicture
                  agentId={evaluation.agentId}
                  machineId={evaluation.machineId}
                  size={ICON_SIZE.rowLead}
                />
              )}
              <span className="min-w-0 truncate font-mono text-xs text-fg">{labelText}</span>
            </span>
            <span className="font-mono text-xs text-fg-muted">v{evaluation.version}</span>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-2">
            <Metric label={s.benchmark.colScore} value={formatScore(evaluation.score)} strong />
            <Metric label={s.common.cost} value={formatMoney(evaluation.cost, wb.currency)} />
            <Metric
              label={s.benchmark.colDuration}
              value={humanizeDuration(evaluation.durationMs)}
            />
          </div>

          {(evaluation.summaryTitle || evaluation.summary) && (
            <div>
              <p
                className={`text-xs font-semibold ${evaluation.summaryTitle ? "text-fg" : "text-fg-muted"}`}
              >
                {evaluation.summaryTitle || s.benchmark.summaryLabel}
              </p>
              {evaluation.summary && (
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-fg-muted">
                  {evaluation.summary}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-semibold text-fg-muted">{s.benchmark.cases}</p>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-line text-xs text-fg-muted">
                    <th className="px-2 py-1.5 font-medium">{s.benchmark.colCase}</th>
                    <th className="px-2 py-1.5 font-medium">{s.benchmark.colScore}</th>
                    <th className="px-2 py-1.5 font-medium">{s.common.cost}</th>
                    <th className="px-2 py-1.5 font-medium">{s.benchmark.colDuration}</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.cases.map((c) => (
                    <CaseRow
                      key={c.case}
                      caseScore={c}
                      {...(caseTitles.has(c.case) ? { title: caseTitles.get(c.case)! } : {})}
                      currency={wb.currency}
                      onOpenRun={(id) => void openRun(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {runError !== null && <FailureLine text={runError} className="mt-2" />}
          </div>
        </div>
      </Modal>

      {asking && (
        <AskDialog
          benchmarkId={benchmarkId}
          subject={{ evaluation: askFacts(evaluation, labelText, wb.currency) }}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}
