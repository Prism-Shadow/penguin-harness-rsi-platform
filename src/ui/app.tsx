/**
 * The frame's root: the interface language and the Project the host wrote on `<html>`, the
 * location inside the app, and the UI package's page-wide layers (toasts, the shared tooltip, the
 * unsaved-changes prompt). Until the host names a Project the page shows nothing. A Project switch
 * mounts a fresh workbench, which reads everything again, and an open Benchmark — one of the
 * previous Project's — gives way to the new Project's list.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  DEFAULT_UI_STRINGS,
  Toaster,
  TooltipLayer,
  UiStringsProvider,
  UnsavedChangesHost,
  type UiStrings,
} from "@prismshadow/penguin-ui";
import { StringsContext } from "./context";
import { useFrameFacts } from "./frame-facts";
import { useInnerLocation } from "./router";
import { stringsFor } from "./strings";
import { Workbench } from "./pages/workbench";

export function App() {
  const { locale, projectId } = useFrameFacts();
  const location = useInnerLocation();
  const s = stringsFor(locale);
  const ui = useMemo<UiStrings>(() => ({ ...s.ui, a2ui: DEFAULT_UI_STRINGS.a2ui }), [s]);

  const shownProject = useRef(projectId);
  const { route, go } = location;
  useEffect(() => {
    const previous = shownProject.current;
    shownProject.current = projectId;
    if (
      previous !== null &&
      projectId !== null &&
      previous !== projectId &&
      route.benchmarkId !== null
    ) {
      go({ benchmarkId: null, agentId: null });
    }
  }, [projectId, route.benchmarkId, go]);

  if (projectId === null) return null;
  return (
    <StringsContext.Provider value={s}>
      <UiStringsProvider strings={ui}>
        <Workbench key={projectId} projectId={projectId} locale={locale} location={location} />
        <Toaster />
        <TooltipLayer />
        <UnsavedChangesHost
          title={s.common.discardTitle}
          body={s.common.discardBody}
          discardLabel={s.common.discard}
          keepLabel={s.common.keepEditing}
        />
      </UiStringsProvider>
    </StringsContext.Provider>
  );
}
