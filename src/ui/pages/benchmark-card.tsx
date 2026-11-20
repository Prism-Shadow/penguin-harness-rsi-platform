/**
 * One Benchmark on the list: an info column of title, description and stats, then the Agents it
 * has tested, the sparkline, the newest Score with its change from the previous record of the same
 * label, and the actions. The info column is the card's main button — it enters the Benchmark's
 * page — and a click anywhere else on the body does too. A card that is not published is masked
 * under a notice — still being built for a draft, creation failed for a Benchmark whose
 * calibration never finished, or a manifest that cannot be read, with the reason behind an icon —
 * with only the owner's delete left live, which is how either is cleaned up.
 */
import type { MouseEvent } from "react";
import {
  Button,
  Card,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Sparkline,
} from "@prismshadow/penguin-ui";
import type { MergedBenchmark } from "../../api";
import { useStrings, useWorkbench } from "../context";
import { formatRelativeShort, formatScore, signedDelta } from "../format";
import { benchmarkDescription, benchmarkTitle, latestWithDelta, sparklineSeries } from "../metrics";
import { AgentPictureStack } from "./agent-picture";

/** How many tested Agents a card draws before the rest fold into a "+n". */
const AVATARS_SHOWN = 3;

/** Controls inside a card that act on their own: a click on one is not a click on the body. */
const CONTROL = "a[href], button, input, select, textarea, label, [role='button']";

/** A click on the card's body (not on a control inside it, nor one that only bubbled from a portal). */
function cardBodyClick(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const target = event.target as Element | null;
    if (target === null || !card.contains(target)) return;
    const control = target.closest(CONTROL);
    if (control === null || !card.contains(control)) open();
  };
}

function deltaTone(delta: number | null): string {
  if (delta === null || delta === 0) return "text-fg-subtle";
  return delta > 0 ? "text-tone-success-fg" : "text-tone-danger-fg";
}

export function BenchmarkCard({
  benchmark,
  canDelete,
  onOpen,
  onUse,
  onDelete,
}: {
  benchmark: MergedBenchmark;
  /** Only the owner deletes, and only this server's copy. */
  canDelete: boolean;
  onOpen: () => void;
  onUse: () => void;
  onDelete: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const latest = latestWithDelta(benchmark.evaluations);
  const series = sparklineSeries(benchmark.evaluations);
  const masked = benchmark.status !== "published";
  const failed = benchmark.status === "failed";
  const broken = benchmark.manifestError;
  // Deleting and creating again is a failed Benchmark's only way out, and the hint names that
  // step only to a viewer who has the delete button beside it.
  const failedHint =
    broken !== undefined
      ? canDelete
        ? s.benchmark.manifestBrokenHint
        : s.benchmark.manifestBrokenHintMember
      : canDelete
        ? s.benchmark.creationFailedHint
        : s.benchmark.creationFailedHintMember;
  const onlyMachine =
    benchmark.machineIds.length === 1 ? wb.machineName(benchmark.machineIds[0] ?? null) : null;
  const title = benchmarkTitle(benchmark, wb.locale);
  const when = latest !== null ? formatRelativeShort(latest.time, s.relative) : "";
  const testedNames = benchmark.agentIds.map(wb.agentName).join(", ");

  return (
    <Card
      as="li"
      padding="md"
      interactive={!masked}
      className="relative flex flex-wrap items-center gap-x-6 gap-y-2"
      {...(masked ? {} : { onClick: cardBodyClick(onOpen) })}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={masked}
        className="min-w-[14rem] flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold">
            {onlyMachine !== null ? s.machines.onMachine(title, onlyMachine) : title}
          </span>
        </span>
        {/* An empty description still takes its line, so the cards keep one height. */}
        <span className="mt-1.5 block min-h-4 truncate text-xs text-fg-muted">
          {benchmarkDescription(benchmark, wb.locale) ?? ""}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span className="shrink-0">{s.benchmark.caseCount(benchmark.caseCount)}</span>
          <span className="shrink-0">{s.benchmark.runsPerCase(benchmark.runs ?? 1)}</span>
          {latest !== null && when !== "" && (
            <span
              className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}
              data-tooltip={s.benchmark.lastEvaluated(when)}
            >
              <GlyphIcon d={ICONS.clockCompact} size={ICON_SIZE.inlineGlyph} />
              {when}
            </span>
          )}
        </span>
      </button>
      {benchmark.agentIds.length > 0 && (
        <div
          className="hidden shrink-0 sm:flex"
          data-tooltip={`${s.benchmark.testedAgents}: ${testedNames}`}
          data-tooltip-extra
        >
          <AgentPictureStack
            agentIds={benchmark.agentIds}
            max={AVATARS_SHOWN}
            size={ICON_SIZE.rowLead}
          />
        </div>
      )}
      {series.length > 0 && (
        <div className="hidden shrink-0 md:block">
          <Sparkline
            values={series}
            label={s.benchmark.sparklineLabel(series.length)}
            scale="range"
            marker
          />
        </div>
      )}
      <div className="min-w-16 shrink-0 text-right">
        {latest !== null ? (
          <>
            <span
              className="block font-mono text-sm font-semibold tabular-nums"
              data-tooltip={s.benchmark.latestScoreLabel}
            >
              {formatScore(latest.score)}
            </span>
            <span
              className={`block whitespace-nowrap text-xs tabular-nums ${deltaTone(latest.delta)}`}
            >
              {latest.delta === null
                ? s.benchmark.firstEvaluation
                : latest.delta === 0
                  ? "0"
                  : signedDelta(formatScore(latest.delta))}
            </span>
          </>
        ) : (
          <span className="block whitespace-nowrap text-xs text-fg-subtle">
            {s.benchmark.notEvaluated}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="primary" onClick={onUse} disabled={masked}>
          {s.benchmark.use}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen} disabled={masked}>
          {s.benchmark.view}
        </Button>
        {canDelete && (
          <Button
            size="icon"
            variant="ghost"
            title={s.benchmark.deleteBenchmark}
            aria-label={s.benchmark.deleteBenchmark}
            onClick={onDelete}
            className={masked ? "relative z-10" : undefined}
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </Button>
        )}
      </div>
      {masked && (
        <div
          role="note"
          className="absolute inset-0 flex cursor-not-allowed flex-col items-center justify-center gap-1 rounded-[inherit] bg-surface/75 px-4 text-center"
        >
          <span className={`inline-flex items-center ${ICON_GAP.row} text-sm font-medium text-fg`}>
            {failed && (
              <span className="text-tone-danger-fg" aria-hidden>
                <GlyphIcon d={ICONS.alertCircle} size={ICON_SIZE.inlineGlyph} />
              </span>
            )}
            {broken !== undefined
              ? s.benchmark.manifestBroken
              : failed
                ? s.benchmark.creationFailed
                : s.benchmark.building}
            {broken !== undefined && (
              <span role="img" data-tooltip={broken.message} aria-label={broken.message}>
                <GlyphIcon d={ICONS.info} size={ICON_SIZE.inlineGlyph} />
              </span>
            )}
          </span>
          <span className="text-xs text-fg-muted">
            {failed ? failedHint : s.benchmark.buildingHint}
          </span>
        </div>
      )}
    </Card>
  );
}
