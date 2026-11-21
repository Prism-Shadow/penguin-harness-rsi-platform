/**
 * The Agent tasks the page started, beside the conversations they run in. A Benchmark's page lists
 * the tasks started on it; the list page lists the newest create and import tasks, which belong to
 * no Benchmark. Each is one ruled row — what kind of task it is and its conversation's title (its
 * start time until it has one), where it stands, and Open chat — and a task whose conversation is
 * gone is not listed.
 *
 * The list is read every five seconds while the page can be seen, and not at all while it cannot —
 * the browser tab hidden, or the App Center window minimized (bridge.ts `pageShown`); it is read at
 * once when the tab shows again, within one interval when the window comes back, and when a task
 * starts. A task that has just finished is announced to the caller (`onSettled`), since what it
 * wrote — a new evaluation, a new Benchmark — is in the list the page shows.
 *
 * The confirmation a start shows lives here too: one line, Open chat, and a close.
 */
import { useEffect, useRef, useState } from "react";
import {
  Button,
  CloseButton,
  NoticeStrip,
  RuledSection,
  StatusIcon,
} from "@prismshadow/penguin-ui";
import type { TaskState, WorkbenchTask } from "../../api";
import { pageShown } from "../bridge";
import { useStrings, useWorkbench } from "../context";
import { formatDateTime } from "../format";

/** How often a task list is read while it is visible. */
export const TASK_POLL_MS = 5000;

const isLive = (state: TaskState) => state === "running" || state === "waiting";

/** The tasks on `benchmarkId` (every task when undefined), newest first; null until read. */
export function useTasks(
  benchmarkId: string | undefined,
  onSettled?: () => void,
): WorkbenchTask[] | null {
  const wb = useWorkbench();
  const [tasks, setTasks] = useState<WorkbenchTask[] | null>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    let seq = 0;
    const states = new Map<string, TaskState>();
    const read = () => {
      const ask = ++seq;
      wb.api.tasks(benchmarkId).then(
        (res) => {
          if (!live || ask !== seq) return;
          let finished = false;
          for (const task of res.tasks) {
            const before = states.get(task.sessionId);
            if (before !== undefined && isLive(before) && !isLive(task.state)) finished = true;
            states.set(task.sessionId, task.state);
          }
          setTasks(res.tasks);
          if (finished) settled.current?.();
        },
        () => {
          // A failed read leaves the rows as they were; the next one tries again.
        },
      );
    };
    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    // A hidden tab stops the timer (its visibilitychange restarts it); a minimized window's page
    // keeps only the check, which costs no request.
    const schedule = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        if (pageShown()) read();
        schedule();
      }, TASK_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (pageShown()) read();
        schedule();
      } else {
        stop();
      }
    };
    if (pageShown()) read();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [wb.api, benchmarkId, wb.tasksKey]);

  return tasks;
}

function TaskRow({ task }: { task: WorkbenchTask }) {
  const s = useStrings();
  const wb = useWorkbench();
  const what =
    task.title !== undefined && task.title !== "" ? task.title : formatDateTime(task.createdAt);
  const state = task.state === "gone" ? "done" : task.state;
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-line-muted py-1.5 last:border-b-0">
      <span
        className="min-w-0 flex-1 truncate text-sm"
        data-tooltip={what}
        data-tooltip-content="text"
      >
        <span className="font-medium text-fg">{s.tasks.kinds[task.kind]}</span>
        <span className="text-fg-muted">{` · ${what}`}</span>
      </span>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted"
        {...(task.state === "waiting" && task.pendingApprovals > 0
          ? { "data-tooltip": s.tasks.pendingApprovals(task.pendingApprovals) }
          : {})}
      >
        <StatusIcon state={state} size="sm" />
        {s.tasks.states[task.state]}
      </span>
      <Button size="sm" variant="ghost" onClick={() => wb.openSession(task.sessionId)}>
        {s.tasks.openChat}
      </Button>
    </li>
  );
}

/**
 * A ruled section of task rows, or nothing while there are none to show. `limit` keeps the newest
 * few (the list page's compact section).
 */
export function TasksSection({
  title,
  tasks,
  limit,
  className = "",
}: {
  title: string;
  tasks: readonly WorkbenchTask[] | null;
  limit?: number;
  className?: string;
}) {
  const shown = (tasks ?? []).filter((t) => t.state !== "gone").slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <RuledSection title={title} level={2} className={className}>
      <ul aria-label={title}>
        {shown.map((task) => (
          <TaskRow key={task.sessionId} task={task} />
        ))}
      </ul>
    </RuledSection>
  );
}

/** The line a start leaves on the page: what started, and the way into its conversation. */
export function StartedNotice() {
  const s = useStrings();
  const wb = useWorkbench();
  const task = wb.lastStarted;
  if (task === null) return null;
  return (
    <NoticeStrip
      tone="success"
      role="status"
      className="mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
    >
      <span className="min-w-0 flex-1">{s.tasks.started(s.tasks.kinds[task.kind])}</span>
      <Button size="sm" variant="secondary" onClick={() => wb.openSession(task.sessionId)}>
        {s.tasks.openChat}
      </Button>
      <CloseButton onClose={wb.dismissStarted} label={s.tasks.dismiss} />
    </NoticeStrip>
  );
}
