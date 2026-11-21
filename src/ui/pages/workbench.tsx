/**
 * The workbench for one Project: it reads the Project's view (`…/benchmarks/context`: the viewer's
 * role, the Agents, the models, the toolkits, the machines), the viewer's currency and the
 * Benchmark list — this server's and, for an admin, each machine's, merged as they land
 * (../sources.ts) — and shows the list or one Benchmark by where the page is. The list is read
 * again whenever the page moves between the two — what is on screen stays until the new answers
 * land — and after anything the page did that changes it. A Project switch mounts a new workbench,
 * so nothing of the previous Project's carries over.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, PageFrame } from "@prismshadow/penguin-ui";
import type { WorkbenchContext, WorkbenchTask } from "../../api";
import { getPrefs, projectApi } from "../api";
import { postNavigate } from "../bridge";
import { WorkbenchCtx, useStrings, type WorkbenchValue } from "../context";
import type { Currency } from "../format";
import type { Locale } from "../frame-facts";
import type { InnerLocation } from "../router";
import { useBenchmarkSources } from "../sources";
import { DetailPage } from "./detail-page";
import { FailureLine, errorText } from "./failure";
import { CardSkeletons, ListPage } from "./list-page";

export function Workbench({
  projectId,
  locale,
  location,
}: {
  projectId: string;
  locale: Locale;
  location: InnerLocation;
}) {
  const s = useStrings();
  const api = useMemo(() => projectApi(projectId), [projectId]);
  const [context, setContext] = useState<WorkbenchContext | null>(null);
  const [contextError, setContextError] = useState<unknown>(null);
  const [contextKey, setContextKey] = useState(0);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [listKey, setListKey] = useState(0);
  const [lastStarted, setLastStarted] = useState<WorkbenchTask | null>(null);
  const [tasksKey, setTasksKey] = useState(0);
  const { route, go } = location;

  useEffect(() => {
    let live = true;
    api.context().then(
      (next) => {
        if (!live) return;
        setContext(next);
        setContextError(null);
      },
      (e: unknown) => {
        if (live) setContextError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [api, contextKey]);

  useEffect(() => {
    let live = true;
    getPrefs().then(
      (res) => {
        if (live) setCurrency(res.prefs?.currency === "CNY" ? "CNY" : "USD");
      },
      () => {
        // The viewer's preferences could not be read: costs stay in USD.
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const machineIds = useMemo(
    () => (context?.machines ?? []).map((machine) => machine.machineId),
    [context],
  );
  const { listed, error: listError } = useBenchmarkSources(
    api,
    machineIds,
    `${route.benchmarkId ?? ""}|${listKey}`,
  );

  const reloadList = useCallback(() => setListKey((n) => n + 1), []);
  const reloadContext = useCallback(() => setContextKey((n) => n + 1), []);
  const started = useCallback((task: WorkbenchTask) => {
    setLastStarted(task);
    setTasksKey((n) => n + 1);
  }, []);
  const dismissStarted = useCallback(() => setLastStarted(null), []);
  const openSession = useCallback(
    (sessionId: string) => postNavigate(`/chat/${encodeURIComponent(sessionId)}`),
    [],
  );

  const value = useMemo<WorkbenchValue | null>(() => {
    if (context === null) return null;
    const agentOf = (agentId: string) => context.agents.find((a) => a.agentId === agentId);
    return {
      projectId,
      api,
      locale,
      context,
      currency,
      isOwner: context.role === "owner",
      agents: context.agents,
      defaultAgentId: context.defaultAgentId,
      agentName: (agentId) => {
        const name = agentOf(agentId)?.name;
        return name !== undefined && name !== "" ? name : agentId;
      },
      agentPicture: (agentId, machineId = null) => {
        if (machineId !== null) return undefined;
        const rev = agentOf(agentId)?.avatarRev;
        return rev === undefined ? undefined : api.avatarUrl(agentId, rev);
      },
      machineName: (machineId) =>
        machineId === null
          ? null
          : (context.machines.find((m) => m.machineId === machineId)?.label ?? machineId),
      route,
      go,
      openSession,
      started,
      lastStarted,
      dismissStarted,
      tasksKey,
      reloadContext,
    };
  }, [
    context,
    projectId,
    api,
    locale,
    currency,
    route,
    go,
    openSession,
    started,
    lastStarted,
    dismissStarted,
    tasksKey,
    reloadContext,
  ]);

  if (value === null) {
    return (
      <PageFrame width="lg">
        {contextError !== null ? (
          <FailureLine
            text={errorText(contextError, s)}
            action={
              <Button size="xs" variant="link" onClick={reloadContext}>
                {s.common.retry}
              </Button>
            }
          />
        ) : (
          <CardSkeletons rows={4} />
        )}
      </PageFrame>
    );
  }

  return (
    <WorkbenchCtx.Provider value={value}>
      {route.benchmarkId === null ? (
        <ListPage listed={listed} error={listError} onChanged={reloadList} />
      ) : (
        <DetailPage
          benchmarkId={route.benchmarkId}
          listed={listed}
          error={listError}
          onChanged={reloadList}
        />
      )}
    </WorkbenchCtx.Provider>
  );
}
