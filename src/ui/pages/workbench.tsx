/**
 * The workbench of one Agent: it reads the Project as the viewer sees it from the Web App's routes
 * (context-load.ts: the Agents, the models, the toolkits, the machines), the viewer's currency and
 * the Benchmark list — this workbench's and, for an admin, each machine's copy of the same Agent's
 * workbench, merged as they land (../sources.ts) — and shows the list or one Benchmark by where the
 * page is. The list is read again whenever the page moves between the two — what is on screen
 * stays until the new answers land — and after anything the page did that changes it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, PageFrame, Waiting } from "@prismshadow/penguin-ui";
import type { WorkbenchContext, WorkbenchTask } from "../../api";
import { agentSkills } from "../agent-skills";
import { hostApi, workbenchApi } from "../api";
import { openInHost } from "../bridge";
import { loadContext } from "../context-load";
import { WorkbenchCtx, useStrings, type WorkbenchValue } from "../context";
import type { Currency } from "../format";
import type { Locale, PageAddress } from "../frame-facts";
import { sourceResolver } from "../machine-sources";
import type { InnerLocation } from "../router";
import { useBenchmarkSources } from "../sources";
import { DetailPage } from "./detail-page";
import { FailureLine, errorText } from "./failure";
import { CardSkeletons, ListPage } from "./list-page";

export function Workbench({
  address,
  locale,
  location,
}: {
  address: PageAddress;
  locale: Locale;
  location: InnerLocation;
}) {
  const s = useStrings();
  const api = useMemo(() => workbenchApi(address), [address]);
  const host = useMemo(() => hostApi(address.apiBase, address.projectId), [address]);
  const sources = useMemo(() => sourceResolver(address, api.benchmarks), [address, api]);
  const skills = useMemo(() => agentSkills(host), [host]);
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
    loadContext(address, host).then(
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
  }, [address, host, contextKey]);

  useEffect(() => {
    let live = true;
    host.prefs().then(
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
  }, [host]);

  const machineIds = useMemo(
    () => (context?.machines ?? []).map((machine) => machine.machineId),
    [context],
  );
  const { listed, error: listError } = useBenchmarkSources(
    sources,
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
    (sessionId: string) => openInHost(`/chat/${encodeURIComponent(sessionId)}`),
    [],
  );

  const value = useMemo<WorkbenchValue | null>(() => {
    if (context === null) return null;
    const agentOf = (agentId: string) => context.agents.find((a) => a.agentId === agentId);
    return {
      address,
      api,
      host,
      sources,
      skills,
      locale,
      context,
      currency,
      agents: context.agents,
      defaultAgentId: context.defaultAgentId,
      agentName: (agentId) => {
        const name = agentOf(agentId)?.name;
        return name !== undefined && name !== "" ? name : agentId;
      },
      agentPicture: (agentId, machineId = null) => {
        if (machineId !== null) return undefined;
        const rev = agentOf(agentId)?.avatarRev;
        return rev === undefined ? undefined : host.avatarUrl(agentId, rev);
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
    };
  }, [
    context,
    address,
    api,
    host,
    sources,
    skills,
    locale,
    currency,
    route,
    go,
    openSession,
    started,
    lastStarted,
    dismissStarted,
    tasksKey,
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
          <Waiting label={s.common.loading}>
            <CardSkeletons rows={4} />
          </Waiting>
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
