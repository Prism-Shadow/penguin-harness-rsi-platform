/**
 * One Benchmark's own page (`/<benchmarkId>`): its title with the directory its files live in and
 * the version they are at, the Use entry point, the detail itself — chart, evaluation table,
 * case browser — and the tasks started on it. The back button is the way out. An id that no longer
 * resolves — a deleted Benchmark or a stale link — says so in place of the detail. A Benchmark that
 * is not published keeps the path but drops Use, and shows the building, creation-failed or
 * broken-manifest notice in place of the detail.
 */
import { useState } from "react";
import {
  Button,
  CopyButton,
  EmptyState,
  GlyphIcon,
  ICONS,
  PageFrame,
  PageHeader,
  Waiting,
} from "@prismshadow/penguin-ui";
import type {
  BenchmarkManifestProblem,
  BenchmarkSummary,
  MergedBenchmark,
  WorkbenchBenchmarksResponse,
} from "../../api";
import { useStrings, useWorkbench } from "../context";
import { benchmarkTitle } from "../metrics";
import { BenchmarkDetail } from "./benchmark-detail";
import { FailureLine, errorText } from "./failure";
import { MachinesNotice } from "./list-page";
import { StartedNotice, TasksSection, useTasks } from "./tasks";
import { UseDialog } from "./use-dialog";

/**
 * The Benchmark's folder as its page names it, from the absolute `dir` the server holding the copy
 * gave: relative to the Project's folder when `dir` lies inside one — the last folder named like
 * the Project above the Benchmark's own — and whole otherwise. Wherever the host keeps the
 * Benchmarks (`<project>/benchmarks/`, or the system Agent's app data folder), the label says that
 * place. A copy listed with no `dir` comes from a harness that still served the Evaluation Center
 * itself, which kept its Benchmarks in `<project>/benchmarks/`.
 */
export function benchmarkFolderLabel(
  dir: string | undefined,
  projectId: string,
  benchmarkId: string,
): string {
  if (dir === undefined || dir === "") return `benchmarks/${benchmarkId}`;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] === projectId) return parts.slice(i + 1).join(sep);
  }
  return dir;
}

/**
 * What stands in place of the detail for a Benchmark that is not published. Deleting and creating
 * again is a failed Benchmark's only way out, and every member may delete one.
 */
export function UnpublishedNotice({
  failed,
  manifestError,
}: {
  failed: boolean;
  manifestError?: BenchmarkManifestProblem;
}) {
  const s = useStrings();
  if (manifestError !== undefined) {
    // The page has no Delete of its own: the list card offers it, for this server's copy.
    const hint = s.benchmark.manifestBrokenHintMember;
    return (
      <EmptyState
        title={s.benchmark.manifestBroken}
        description={s.benchmark.manifestBrokenDetail(hint, manifestError.message)}
      />
    );
  }
  if (!failed) {
    return <EmptyState title={s.benchmark.building} description={s.benchmark.buildingDetail} />;
  }
  return (
    <EmptyState title={s.benchmark.creationFailed} description={s.benchmark.creationFailedDetail} />
  );
}

/** `url` when it is an http(s) link, else null: a source link must never run anything. */
function webLink(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The copy button's quiet look, for the export link beside it. */
const QUIET_ICON_BUTTON =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted";

/**
 * What the header says under the title: the directory the files live in, with a copy button that
 * copies the absolute folder as the server holding the copy named it, and — for a published
 * Benchmark — Export beside it, a download of its package from that server; the version its
 * manifest is at; and, for a copy an Agent imported from a repository folder, a link to that folder.
 */
export function BenchmarkHeaderFacts({
  benchmark,
  exportUrl,
}: {
  benchmark: Pick<BenchmarkSummary, "id" | "version" | "origin" | "dir"> &
    Partial<Pick<BenchmarkSummary, "status">>;
  /** The package download; offered only for a published Benchmark. */
  exportUrl?: string;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const source = benchmark.origin?.kind === "git" ? webLink(benchmark.origin.url) : null;
  const folder = benchmarkFolderLabel(benchmark.dir, wb.address.projectId, benchmark.id);
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate font-mono text-xs text-fg-subtle">{folder}</span>
          <CopyButton
            text={benchmark.dir ?? folder}
            label={s.benchmark.copyPath}
            size="sm"
            className="shrink-0"
          />
          {exportUrl !== undefined && benchmark.status === "published" && (
            <a
              href={exportUrl}
              download
              data-tooltip={s.benchmark.exportBenchmark}
              aria-label={s.benchmark.exportBenchmark}
              className={QUIET_ICON_BUTTON}
            >
              <GlyphIcon d={ICONS.download} />
            </a>
          )}
        </span>
        {benchmark.version !== undefined && benchmark.version !== "" && (
          <span className="shrink-0 text-xs">
            <span className="text-fg-muted">{s.benchmark.versionLabel}</span>{" "}
            <span className="font-semibold tabular-nums text-fg">v{benchmark.version}</span>
          </span>
        )}
      </span>
      {source !== null && (
        // A line with no width of its own: a long folder link truncates rather than pushing the
        // title row's button onto a line of its own.
        <span className="mt-1 flex w-0 min-w-full items-center gap-1 text-xs">
          <span className="shrink-0 text-fg-muted">{s.benchmark.sourceLabel}</span>
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip={source}
            className="min-w-0 truncate text-link underline-offset-2 hover:underline"
          >
            {source.replace(/^https?:\/\//, "")}
          </a>
        </span>
      )}
    </span>
  );
}

export function DetailPage({
  benchmarkId,
  listed,
  error,
  onChanged,
}: {
  benchmarkId: string;
  listed: WorkbenchBenchmarksResponse | null;
  error: unknown;
  onChanged: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const [using, setUsing] = useState(false);
  const tasks = useTasks(benchmarkId, onChanged);
  const benchmark: MergedBenchmark | null =
    listed?.benchmarks.find((b) => b.id === benchmarkId) ?? null;
  // Not found only once no machine is still being read: a copy only a machine holds joins late.
  const missing = benchmark === null && listed !== null && (listed.pending ?? []).length === 0;
  const masked = benchmark !== null && benchmark.status !== "published";
  const failed = benchmark !== null && benchmark.status === "failed";
  const onlyMachine =
    benchmark !== null && benchmark.machineIds.length === 1
      ? wb.machineName(benchmark.machineIds[0] ?? null)
      : null;
  const title = benchmark === null ? benchmarkId : benchmarkTitle(benchmark, wb.locale);

  let body;
  if (listed === null && error !== null) {
    body = <FailureLine text={errorText(error, s)} />;
  } else if (missing) {
    body = <EmptyState title={s.benchmark.notFound} description={s.benchmark.notFoundHint} />;
  } else if (benchmark === null) {
    body = <Waiting form="page" label={s.common.loading} />;
  } else if (masked) {
    body = (
      <UnpublishedNotice
        failed={failed}
        {...(benchmark.manifestError !== undefined
          ? { manifestError: benchmark.manifestError }
          : {})}
      />
    );
  } else {
    body = <BenchmarkDetail key={benchmark.id} benchmark={benchmark} />;
  }

  return (
    <PageFrame width="md">
      <PageHeader
        back={{
          label: s.benchmark.backToList,
          onClick: () => wb.go({ benchmarkId: null, agentId: wb.route.agentId }),
        }}
        title={
          <span className="min-w-0 truncate">
            {onlyMachine !== null ? s.machines.onMachine(title, onlyMachine) : title}
          </span>
        }
        {...(benchmark !== null
          ? {
              description: (
                <BenchmarkHeaderFacts
                  benchmark={benchmark}
                  exportUrl={
                    wb.sources
                      .resolved(benchmark.machineIds[0] ?? null)
                      ?.archiveUrl(benchmark.id) ?? undefined
                  }
                />
              ),
            }
          : {})}
        {...(benchmark !== null && !masked
          ? {
              actions: (
                <Button size="sm" variant="primary" onClick={() => setUsing(true)}>
                  {s.benchmark.use}
                </Button>
              ),
            }
          : {})}
      />
      <StartedNotice />
      <MachinesNotice listed={listed} />
      {body}
      <TasksSection title={s.tasks.title} tasks={tasks} className="mt-6" />

      {using && benchmark !== null && !masked && (
        <UseDialog key={benchmark.id} benchmark={benchmark} onClose={() => setUsing(false)} />
      )}
    </PageFrame>
  );
}
