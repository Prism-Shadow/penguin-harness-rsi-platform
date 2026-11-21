/**
 * The list: every Benchmark of the Project as one card, with the loop a novice needs spelled out in
 * three step cards under the title — write the cases, evaluate an agent on them, optimize it
 * against the scores. A Benchmark sits beside the Agents rather than under one, so the page is a
 * flat list, and the Agents a card names are the ones its scoreboard has tested. `?agentId=`
 * narrows the list to the Benchmarks that tested that Agent.
 *
 * For an admin the server has already merged every machine's copies; a machine that did not answer
 * is named in one quiet line above the list. Besides creating a Benchmark, any member may import
 * one; creating by hand and deleting are the owner's. The create and import tasks started here
 * belong to no Benchmark, so the newest few are listed under the cards.
 */
import { useState } from "react";
import {
  Button,
  ConfirmModal,
  CreateButtons,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
  NoticeStrip,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonCard,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { MergedBenchmark, WorkbenchBenchmarksResponse } from "../../api";
import { useStrings, useWorkbench } from "../context";
import { benchmarkTitle, matchesBenchmarkQuery } from "../metrics";
import { AgentPicture } from "./agent-picture";
import { BenchmarkCard } from "./benchmark-card";
import { CreateWithAiDialog } from "./create-ai-dialog";
import { ManualCreateDialog } from "./manual-create-dialog";
import { FailureLine, errorText } from "./failure";
import { ImportDialog } from "./import-dialog";
import { StartedNotice, TasksSection, useTasks } from "./tasks";
import { UseDialog } from "./use-dialog";

/** How many create and import tasks the list keeps on screen. */
const RECENT_TASKS = 3;

/**
 * The header's entry points: Import benchmark for every member, then Create with AI, and Create
 * manually for the owner alone (the create route answers anyone else with 403).
 */
export function CreateEntries({
  onAi,
  onManual,
  onImport,
}: {
  onAi: () => void;
  onManual: () => void;
  onImport?: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const create = (
    <CreateButtons
      size="sm"
      onAi={onAi}
      aiLabel={s.form.withAi}
      {...(wb.isOwner ? { onManual, manualLabel: s.form.manual } : {})}
    />
  );
  if (onImport === undefined) return create;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={onImport}
        leading={<GlyphIcon d={ICONS.upload} size={ICON_SIZE.inlineGlyph} />}
      >
        {s.benchmark.importBenchmark}
      </Button>
      {create}
    </div>
  );
}

/** The three steps of the loop, a card each; a member's first leaves out Create manually. */
function GuideSteps() {
  const s = useStrings();
  const wb = useWorkbench();
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      {s.benchmark.guideFlow.map((step, i) => (
        <div
          key={step.title}
          className="min-w-0 rounded-md border border-line bg-surface-muted px-4 py-3 text-xs text-fg-muted"
        >
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono tabular-nums text-fg-subtle">{i + 1}</span>
            <span className="font-semibold text-fg">{step.title}</span>
          </span>
          <p className="mt-1 leading-relaxed">
            {i === 0 && !wb.isOwner ? s.benchmark.guideCreateMember : step.text}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Card-shaped placeholders, so nothing shifts when the list lands. */
export function CardSkeletons({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
          <div className="min-w-[14rem] flex-1">
            <Skeleton className="h-[18px] w-40" />
            <Skeleton className="mt-1.5 h-4 w-2/3" />
            <Skeleton className="mt-1.5 h-4 w-48" />
          </div>
          <Skeleton className="hidden h-9 w-24 md:block" />
          <Skeleton className="h-8 w-44" />
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * The quiet lines naming the machines whose copies are not in the merged list: those still being
 * read, whose copies join when they answer, and those that gave no answer.
 */
export function MachinesNotice({
  listed,
}: {
  listed: Pick<WorkbenchBenchmarksResponse, "unreachable" | "pending"> | null;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const labels = (ids: readonly string[]) => ids.map((id) => wb.machineName(id) ?? id).join(", ");
  const pending = listed?.pending ?? [];
  const unreachable = listed?.unreachable ?? [];
  return (
    <>
      {pending.length > 0 && (
        <NoticeStrip tone="neutral" className="mb-3 rounded-md border px-3 py-2 text-xs">
          {s.machines.pending(labels(pending))}
        </NoticeStrip>
      )}
      {unreachable.length > 0 && (
        <NoticeStrip tone="neutral" className="mb-3 rounded-md border px-3 py-2 text-xs">
          {s.machines.unreachable(labels(unreachable))}
        </NoticeStrip>
      )}
    </>
  );
}

export function ListPage({
  listed,
  error,
  onChanged,
}: {
  /** The merged list; null until it is read. */
  listed: WorkbenchBenchmarksResponse | null;
  error: unknown;
  /** The list should be read again: something was created, imported or deleted. */
  onChanged: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const filterAgentId = wb.route.agentId;
  const [query, setQuery] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [using, setUsing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tasks = useTasks(undefined, onChanged);
  const projectTasks = tasks?.filter((t) => t.benchmarkId === undefined) ?? null;

  const benchmarks = listed?.benchmarks ?? null;
  const benchmarkOf = (id: string | null): MergedBenchmark | null =>
    id === null ? null : (benchmarks?.find((b) => b.id === id) ?? null);
  const usingBenchmark = benchmarkOf(using);
  const deletingBenchmark = benchmarkOf(deleting);
  const open = (benchmarkId: string) => wb.go({ benchmarkId, agentId: filterAgentId });

  const confirmDelete = async () => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await wb.api.deleteBenchmark(deleting);
      toastSuccess(s.benchmark.deleted);
      setDeleting(null);
      onChanged();
    } catch (e) {
      setDeleteError(errorText(e, s));
    } finally {
      setDeleteBusy(false);
    }
  };

  const rows = (benchmarks ?? [])
    .filter((b) => filterAgentId === null || b.agentIds.includes(filterAgentId))
    .filter((b) => matchesBenchmarkQuery(b, wb.agents, query));

  let body;
  if (benchmarks === null && error !== null) {
    body = <FailureLine text={errorText(error, s)} className="px-1" />;
  } else if (benchmarks === null) {
    body = <CardSkeletons rows={4} />;
  } else if (benchmarks.length === 0) {
    body = (
      <EmptyState
        title={s.benchmark.emptyTitle}
        description={s.benchmark.emptyDescription}
        action={<CreateEntries onAi={() => setAiOpen(true)} onManual={() => setManualOpen(true)} />}
      />
    );
  } else if (rows.length === 0) {
    body = <EmptyState title={s.benchmark.noMatches} />;
  } else {
    body = (
      <ul className="space-y-3" aria-label={s.appTitle}>
        {rows.map((b) => (
          <BenchmarkCard
            key={b.id}
            benchmark={b}
            // Only this server's copy can be deleted from here.
            canDelete={wb.isOwner && b.machineIds.includes(null)}
            onOpen={() => open(b.id)}
            onUse={() => setUsing(b.id)}
            onDelete={() => {
              setDeleteError(null);
              setDeleting(b.id);
            }}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageFrame width="lg">
        <PageHeader
          title={s.appTitle}
          actions={
            <>
              <div className="w-full min-w-0 sm:w-56 sm:flex-none">
                <Input
                  size="sm"
                  aria-label={s.benchmark.searchPlaceholder}
                  placeholder={s.benchmark.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <CreateEntries
                onAi={() => setAiOpen(true)}
                onManual={() => setManualOpen(true)}
                onImport={() => setImportOpen(true)}
              />
            </>
          }
        >
          <GuideSteps />
        </PageHeader>

        <StartedNotice />
        <MachinesNotice listed={listed} />

        {/* What the address filters by, and the way out of it. */}
        {filterAgentId !== null && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <AgentPicture agentId={filterAgentId} size={ICON_SIZE.rowLead} />
            <span
              className="min-w-0 truncate"
              data-tooltip={wb.agentName(filterAgentId)}
              data-tooltip-content="text"
            >
              {s.benchmark.filterByAgent(filterAgentId)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => wb.go({ benchmarkId: null, agentId: null })}
            >
              {s.benchmark.clearFilter}
            </Button>
          </div>
        )}

        {body}

        <TasksSection
          title={s.tasks.recentTitle}
          tasks={projectTasks}
          limit={RECENT_TASKS}
          className="mt-6"
        />
      </PageFrame>

      {aiOpen && (
        <CreateWithAiDialog
          initialTarget={filterAgentId ?? wb.defaultAgentId ?? ""}
          onClose={() => setAiOpen(false)}
        />
      )}
      {manualOpen && (
        <ManualCreateDialog
          takenIds={(benchmarks ?? []).map((b) => b.id)}
          onClose={() => setManualOpen(false)}
          onCreated={(benchmark) => {
            onChanged();
            open(benchmark.id);
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            onChanged();
          }}
        />
      )}
      {usingBenchmark !== null && (
        <UseDialog
          key={usingBenchmark.id}
          benchmark={usingBenchmark}
          onClose={() => setUsing(null)}
        />
      )}
      <ConfirmModal
        open={deleting !== null}
        title={s.benchmark.deleteBenchmark}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        confirmLabel={s.common.delete}
        cancelLabel={s.common.cancel}
        tone="danger"
        busy={deleteBusy}
      >
        <p className="text-sm text-fg">
          {s.benchmark.deleteConfirm(
            deletingBenchmark !== null
              ? benchmarkTitle(deletingBenchmark, wb.locale)
              : (deleting ?? ""),
          )}
        </p>
        {deleteError !== null && <FailureLine text={deleteError} className="mt-2" />}
      </ConfirmModal>
    </>
  );
}
