/**
 * One Benchmark's detail: case counts and description, the case list, a Score-only chart grouped
 * into series by each evaluation's label — the tested Agent, the model and the thinking level —
 * and the evaluation table, which spells that label out across its columns. A row there opens that
 * evaluation in a dialog, a case opens the case browser in another, and either dialog can hand
 * what it shows to an agent as a question. The Benchmark is the merge of every machine holding it:
 * a row names the machine its round was read from when there is more than one, and a case's files
 * are read from the server that listed it.
 */
import { useEffect, useState } from "react";
import {
  Button,
  ChartFrame,
  ChartLine,
  ChartPoint,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Legend,
  Modal,
  Pager,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  makeRangeGeom,
  segmentPoints,
  useChartWidth,
  type ChartPaint,
} from "@prismshadow/penguin-ui";
import type { AskCaseFacts, MergedBenchmark, MergedCase, MergedEvaluation } from "../../api";
import { CASES_PER_PAGE, casePage } from "../../api";
import { useStrings, useWorkbench } from "../context";
import { useBenchmarkCases } from "../sources";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../format";
import {
  benchmarkDescription,
  evaluationLabel,
  labelSeries,
  scoreScale,
  scoreValues,
  seriesPoints,
  type EvaluationSeries,
} from "../metrics";
import { AgentPicture } from "./agent-picture";
import { AskDialog } from "./ask-dialog";
import { CaseBrowser } from "./case-browser";
import { EvaluationDialog } from "./evaluation-dialog";
import { FailureLine, errorText } from "./failure";

/** A series' paint: palette slot i, or the neutral ink for the evaluations with no label. */
const seriesPaint = (series: EvaluationSeries, i: number): ChartPaint =>
  series.unlabeled ? { ink: "text-fg-subtle", swatch: "bg-fg-subtle" } : { series: i };

/**
 * Score over time: one x slot per evaluation in scoreboard order. A change of tested Agent or of
 * runtime starts a series of its own; a new version of the same agent continues the line.
 */
function ScoreTrendChart({
  evaluations,
  series,
}: {
  evaluations: readonly MergedEvaluation[];
  series: EvaluationSeries[];
}) {
  const s = useStrings();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  const values = scoreValues(evaluations);
  const scale = scoreScale(values);
  const geom = makeRangeGeom(evaluations.length, scale.min, scale.max, width);
  const dates = evaluations.map((e) => formatDateTime(e.time));
  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={formatScore}
          dates={dates}
          hover={hover}
          onHover={setHover}
          yTicks={scale.ticks}
          label={s.benchmark.trendTitle(s.benchmark.colScore)}
          bubble={(i) => {
            const e = evaluations[i]!;
            const v = values[i] ?? null;
            const label = evaluationLabel(e);
            return (
              <>
                <p className="text-fg-subtle">{formatDateTime(e.time)}</p>
                <p className="font-mono">
                  {v === null ? "—" : formatScore(v)}
                  <span className="ml-1.5 text-fg-subtle">v{e.version}</span>
                </p>
                <p className="font-mono text-fg-subtle">
                  {label.unlabeled ? s.benchmark.unlabeled : label.text}
                </p>
              </>
            );
          }}
        >
          {series.map((one, si) => {
            const points = seriesPoints(evaluations, one);
            const paint = seriesPaint(one, si);
            return (
              <g key={one.unlabeled ? "unlabeled" : one.key}>
                {points.length > 1 && (
                  <ChartLine
                    points={segmentPoints(geom, points)}
                    paint={paint}
                    opacity={hover !== null ? 0.35 : 1}
                  />
                )}
                {points.map((p) => (
                  <ChartPoint
                    key={p.index}
                    cx={geom.x(p.index)}
                    cy={geom.y(p.value)}
                    paint={paint}
                    grow={hover === p.index}
                    opacity={hover !== null && hover !== p.index ? 0.25 : 1}
                  />
                ))}
              </g>
            );
          })}
        </ChartFrame>
      )}
    </div>
  );
}

function TrendSection({ evaluations }: { evaluations: readonly MergedEvaluation[] }) {
  const s = useStrings();
  const series = labelSeries(evaluations);
  return (
    <section>
      <p className="mb-1 text-xs font-semibold text-fg-muted">
        {s.benchmark.trendTitle(s.benchmark.colScore)}
      </p>
      {series.length >= 2 && (
        <Legend
          items={series.map((one, i) => ({
            key: one.unlabeled ? "unlabeled" : one.key,
            label: one.unlabeled ? s.benchmark.unlabeled : one.text,
            paint: seriesPaint(one, i),
            shape: "block" as const,
          }))}
          mono
          className="mb-1.5"
        />
      )}
      <ScoreTrendChart evaluations={evaluations} series={series} />
    </section>
  );
}

function EvaluationRow({
  evaluation,
  machineName,
  onOpen,
}: {
  evaluation: MergedEvaluation;
  /** The machine whose scoreboard recorded this round, when the Benchmark is held in more than one place. */
  machineName: string | null;
  onOpen: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  return (
    <TableRow onClick={onOpen}>
      <TableCell>
        {/* A table row cannot be a button: the cell that names the record carries the real one. */}
        <button
          type="button"
          className="text-xs hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {formatDateTime(evaluation.time)}
        </button>
        {machineName !== null && (
          <span className="ml-1.5 font-mono text-xs text-fg-subtle">
            {s.machines.machineTag(machineName)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-fg-muted">
        {evaluation.agentId ? (
          <span className="flex items-center gap-1.5">
            <AgentPicture
              agentId={evaluation.agentId}
              machineId={evaluation.machineId}
              size={ICON_SIZE.rowLead}
            />
            <span className="min-w-0 truncate">{wb.agentName(evaluation.agentId)}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-fg-muted">{`v${evaluation.version}`}</TableCell>
      <TableCell
        className="max-w-40 truncate font-mono text-xs text-fg-muted"
        data-tooltip={`${evaluation.provider}/${evaluation.modelId}`}
        data-tooltip-content="code"
      >
        {evaluation.modelId}
      </TableCell>
      <TableCell className="font-mono text-xs text-fg-muted">{evaluation.thinkingLevel}</TableCell>
      <TableCell align="left" numeric className="font-mono text-xs font-semibold">
        {formatScore(evaluation.score)}
      </TableCell>
      <TableCell align="left" numeric className="font-mono text-xs text-fg-muted">
        {formatMoney(evaluation.cost, wb.currency)}
      </TableCell>
      <TableCell align="left" numeric className="font-mono text-xs text-fg-muted">
        {humanizeDuration(evaluation.durationMs)}
      </TableCell>
    </TableRow>
  );
}

/** What the case question carries: how the newest evaluation scored this case, run by run. */
function caseFacts(caseId: string, evaluations: readonly MergedEvaluation[]): AskCaseFacts {
  const newest = evaluations[evaluations.length - 1];
  const scored = newest?.cases.find((c) => c.case === caseId);
  return {
    caseId,
    latest:
      newest !== undefined && scored !== undefined
        ? {
            time: formatDateTime(newest.time),
            score: formatScore(scored.score),
            runs: scored.runs.map((run) => ({
              score: formatScore(run.score),
              sessionId: run.sessionId,
            })),
          }
        : null,
  };
}

function CasesSection({
  cases,
  error,
  page,
  pageCount,
  onChangePage,
  onOpenCase,
}: {
  cases: readonly MergedCase[] | null;
  error: string | null;
  page: number;
  pageCount: number;
  onChangePage: (page: number) => void;
  onOpenCase: (caseId: string) => void;
}) {
  const s = useStrings();
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-line pb-1">
        <p className="text-xs font-semibold text-fg-muted">{s.benchmark.cases}</p>
        {pageCount > 1 && <Pager page={page} pageCount={pageCount} onChange={onChangePage} />}
      </div>
      {error !== null && <FailureLine text={error} className="px-1 py-2" />}
      {cases === null && error === null && (
        <p className="px-1 py-2 text-xs text-fg-subtle">{s.common.loading}</p>
      )}
      <ul>
        {cases?.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpenCase(item.id)}
              className="flex w-full items-center gap-3 border-b border-line-muted px-1 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-muted"
            >
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
                data-tooltip={item.title}
                data-tooltip-content="text"
              >
                {item.title}
              </span>
              <span className="shrink-0 px-2.5 py-1 text-xs font-medium text-fg-muted">
                {s.benchmark.viewCase}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BenchmarkDetail({ benchmark: bm }: { benchmark: MergedBenchmark }) {
  const s = useStrings();
  const wb = useWorkbench();
  const description = benchmarkDescription(bm, wb.locale);
  const [page, setPage] = useState(0);
  const localOnly = bm.machineIds.length === 1 && bm.machineIds[0] === null;
  const casesView = useBenchmarkCases(
    wb.api,
    bm.id,
    bm.machineIds,
    localOnly ? page + 1 : undefined,
  );
  const cases = casesView.cases;
  const count = localOnly ? (casesView.total ?? bm.caseCount) : (cases?.length ?? 0);
  const pageCount = Math.max(1, Math.ceil(count / CASES_PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const shown = localOnly || cases === null ? cases : casePage(cases, current + 1);
  const caseError = casesView.error === null ? null : errorText(casesView.error, s);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  /** Which evaluation's dialog is open, as a position in scoreboard order. */
  const [openEvaluation, setOpenEvaluation] = useState<number | null>(null);
  /** The case whose Ask AI is open; kept as an id so it cannot outlive its case dialog. */
  const [askingCaseId, setAskingCaseId] = useState<string | null>(null);

  // The last page may disappear if cases were removed between reads.
  useEffect(() => {
    if (casesView.total !== undefined && page >= pageCount) setPage(pageCount - 1);
  }, [casesView.total, page, pageCount]);

  // The scoreboard's append order is the evaluation sequence; the table shows it newest first.
  const evaluations = bm.evaluations;
  const openCase = cases?.find((item) => item.id === openCaseId) ?? null;
  const opened = openEvaluation === null ? null : (evaluations[openEvaluation] ?? null);
  // An evaluation displays all its scored cases, including those outside the current page.
  const evaluationCases = useBenchmarkCases(
    wb.api,
    bm.id,
    localOnly && opened?.cases.length ? bm.machineIds : [],
  );
  const caseTitles = new Map(
    (evaluationCases.cases ?? cases)?.map((item) => [item.id, item.title]),
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-fg-muted">
          {s.benchmark.caseCount(bm.caseCount)} · {s.benchmark.runsPerCase(bm.runs ?? 1)}
        </p>
        {description !== undefined && description !== "" && (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        )}
      </div>

      <CasesSection
        cases={shown}
        error={caseError}
        page={current}
        pageCount={pageCount}
        onChangePage={setPage}
        onOpenCase={setOpenCaseId}
      />

      {evaluations.length === 0 ? (
        <EmptyState title={s.benchmark.noEvaluations} description={s.benchmark.noEvaluationsHint} />
      ) : (
        <>
          <TrendSection evaluations={evaluations} />
          <section>
            <p className="mb-1 text-xs font-semibold text-fg-muted">{s.benchmark.evaluations}</p>
            <Table tableClassName="min-w-[820px]">
              <TableHead>
                <TableHeaderCell>{s.common.time}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.agentColumn}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.colVersion}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.colModel}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.colThinkingLevel}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.colScore}</TableHeaderCell>
                <TableHeaderCell>{s.common.cost}</TableHeaderCell>
                <TableHeaderCell>{s.benchmark.colDuration}</TableHeaderCell>
              </TableHead>
              <TableBody>
                {evaluations
                  .map((ev, index) => ({ ev, index }))
                  .reverse()
                  .map(({ ev, index }) => (
                    <EvaluationRow
                      key={index}
                      evaluation={ev}
                      machineName={bm.machineIds.length > 1 ? wb.machineName(ev.machineId) : null}
                      onOpen={() => setOpenEvaluation(index)}
                    />
                  ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}

      {opened !== null && (
        <EvaluationDialog
          benchmarkId={bm.id}
          evaluation={opened}
          caseTitles={caseTitles}
          onClose={() => setOpenEvaluation(null)}
        />
      )}
      {openCase !== null && (
        <Modal
          open
          title={openCase.title}
          widthClass="sm:max-w-6xl"
          onClose={() => {
            setOpenCaseId(null);
            setAskingCaseId(null);
          }}
          footer={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAskingCaseId(openCase.id)}
              leading={<GlyphIcon d={ICONS.wand} size={ICON_SIZE.inlineGlyph} />}
            >
              {s.benchmark.askAi}
            </Button>
          }
        >
          <CaseBrowser benchmarkId={bm.id} item={openCase} />
        </Modal>
      )}
      {openCase !== null && askingCaseId === openCase.id && (
        <AskDialog
          benchmarkId={bm.id}
          subject={{ case: caseFacts(openCase.id, evaluations) }}
          onClose={() => setAskingCaseId(null)}
        />
      )}
    </div>
  );
}
