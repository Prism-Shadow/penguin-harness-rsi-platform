/**
 * The frame's root: whose workbench this is, read from the page's own address; the interface
 * language the host gave it; the location inside the app; and the UI package's page-wide layers
 * (toasts, the shared tooltip, the unsaved-changes prompt). Case READMEs render a diagram fence as
 * code (case-markdown.tsx), so no diagram renderer is in the page.
 */
import { useMemo } from "react";
import {
  DEFAULT_UI_STRINGS,
  MdExtensionsProvider,
  Toaster,
  TooltipLayer,
  UiStringsProvider,
  UnsavedChangesHost,
  type UiStrings,
} from "@prismshadow/penguin-ui";
import { CASE_MARKDOWN } from "./case-markdown";
import { StringsContext } from "./context";
import { pageAddressOf, useLocale } from "./frame-facts";
import { useInnerLocation } from "./router";
import { stringsFor } from "./strings";
import { Workbench } from "./pages/workbench";

export function App() {
  const locale = useLocale();
  const address = useMemo(() => pageAddressOf(window.location.pathname), []);
  const location = useInnerLocation();
  const s = stringsFor(locale);
  const ui = useMemo<UiStrings>(() => ({ ...s.ui, a2ui: DEFAULT_UI_STRINGS.a2ui }), [s]);

  return (
    <StringsContext.Provider value={s}>
      <UiStringsProvider strings={ui}>
        <MdExtensionsProvider extensions={CASE_MARKDOWN}>
          {address === null ? (
            <p className="p-6 text-sm text-fg-muted">{s.common.notInWorkbench}</p>
          ) : (
            <Workbench address={address} locale={locale} location={location} />
          )}
        </MdExtensionsProvider>
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
