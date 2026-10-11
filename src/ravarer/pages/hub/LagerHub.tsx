import { Suspense, useEffect, useState } from "react";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { useSearchParams } from "react-router-dom";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { activeTabFrom } from "@/ravarer/ui/sectionTabsLogic";
import { LAGER_TAB_PARAMS, LAGER_TABS, lagerTabs, RAVARER_EYEBROW, type LagerTab } from "./hubTabs";

const Lager = lazy(() => import("@/ravarer/pages/Lager"));
const Varemottak = lazy(() => import("@/ravarer/pages/Varemottak"));
const Varetelling = lazy(() => import("@/ravarer/pages/Varetelling"));
const StockLedger = lazy(() => import("@/ravarer/components/stock/StockLedger").then(m => ({ default: m.StockLedger })));
const MarginTable = lazy(() => import("@/ravarer/components/stock/MarginTable").then(m => ({ default: m.MarginTable })));
const ReorderSuggestions = lazy(() => import("@/ravarer/components/stock/ReorderSuggestions").then(m => ({ default: m.ReorderSuggestions })));

/** Faner som holdes montert etter første besøk: utkast og filtre overlever fanebytte. */
const KEEP_ALIVE: LagerTab[] = ["telling", "bevegelser"];

/** Lager: seks URL-styrte faner (`?fane=`). Varetelling remonteres ved selskapsbytte. */
export default function LagerHub() {
  const [sp] = useSearchParams();
  const { legalEntityId } = useRavarer();
  const { data: summary } = useWorkSummary({ includeApproval: false });
  const tab = activeTabFrom(sp, "fane", [...LAGER_TABS], "beholdning") as LagerTab;
  // Besøkte faner er bundet til selskapet. Nåværende fane er alltid med — også ved direkte
  // inngang (`?fane=telling`) og etter selskapsbytte — så utkastet holdes montert.
  const [visitedState, setVisitedState] = useState<{ entity: string | null; tabs: Set<LagerTab> }>(
    () => ({ entity: legalEntityId ?? null, tabs: new Set([tab]) }),
  );
  const entity = legalEntityId ?? null;
  const visited = visitedState.entity === entity ? visitedState.tabs : new Set<LagerTab>([tab]);
  useEffect(() => {
    setVisitedState(prev =>
      prev.entity !== entity ? { entity, tabs: new Set([tab]) }
        : prev.tabs.has(tab) ? prev : { entity, tabs: new Set(prev.tabs).add(tab) },
    );
  }, [tab, entity]);

  const pane = (id: LagerTab, node: JSX.Element) => {
    const keep = KEEP_ALIVE.includes(id) && visited.has(id);
    if (tab !== id && !keep) return null;
    return (
      <div key={`${id}-${legalEntityId ?? "x"}`} hidden={tab !== id}>
        {node}
      </div>
    );
  };

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Lager"
      tabs={<SectionTabs ariaLabel="Lager" tabs={lagerTabs(summary)} defaultTab="beholdning" clearParams={LAGER_TAB_PARAMS} />}
    >
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {pane("beholdning", <Lager />)}
        {pane("varemottak", <Varemottak />)}
        {pane("telling", <Varetelling />)}
        {pane("bevegelser", <StockLedger />)}
        {pane("fortjeneste", <MarginTable />)}
        {pane("bestilling", <ReorderSuggestions standalone />)}
      </Suspense>
    </ModulePage>
  );
}
