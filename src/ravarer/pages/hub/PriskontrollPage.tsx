import { Suspense } from "react";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { activeTabFrom } from "@/ravarer/ui/sectionTabsLogic";
import { FakturaerTab } from "@/ravarer/pages/priskontroll/fakturaer/FakturaerTab";
import { normalizePriskontrollSearch } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { ImportSheet } from "@/ravarer/pages/priskontroll/import/ImportSheet";
import { legacyFakturaerRedirect } from "@/ravarer/lib/arkiv/legacyFane";
import { PriskontrollToolsMenu } from "./PriskontrollToolsMenu";
import { PRISKONTROLL_TAB_PARAMS, PRISKONTROLL_TABS, priskontrollTabs, RAVARER_EYEBROW } from "./hubTabs";

const Kostnader = lazy(() => import("@/ravarer/pages/priskontroll/kostnader/KostnaderTab").then((m) => ({ default: m.KostnaderTab })));
const Godkjenning = lazy(() => import("@/ravarer/pages/priskontroll/godkjenning/GodkjenningTab").then((m) => ({ default: m.GodkjenningTab })));

/**
 * Fakturaer = arkiv (opprydding demo D): Fakturaer · Godkjenning · Kostnader. Arbeidet med linjene skjer i Fra faktura;
 * gamle faner (arbeid, varegrupper, leverandørsaker) sendes videre dit innholdet nå ligger.
 */
export default function PriskontrollPage() {
  const [sp, setSp] = useSearchParams();
  const { search } = useLocation();
  const redirect = normalizePriskontrollSearch(search) ?? legacyFakturaerRedirect(search);
  const tab = activeTabFrom(sp, "fane", [...PRISKONTROLL_TABS], "fakturaer");
  const { data: summary } = useWorkSummary({ includeApproval: true });
  if (redirect) return <Navigate to={redirect} replace />;
  const openImport = () => setSp((prev) => { const p = new URLSearchParams(prev); p.set("importer", "ehf"); return p; });

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Fakturaer"
      compact
      fullBleed
      actions={
        <>
          <PriskontrollToolsMenu />
          <Button size="sm" className="gap-1.5" onClick={openImport}>
            <Upload className="h-3.5 w-3.5" aria-hidden />Importer faktura
          </Button>
        </>
      }
      tabs={<SectionTabs ariaLabel="Fakturaer" tabs={priskontrollTabs(summary)} defaultTab="fakturaer" activeId={tab} clearParams={PRISKONTROLL_TAB_PARAMS} />}
    >
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "fakturaer" && <FakturaerTab />}
        {tab === "godkjenning" && <Godkjenning />}
        {tab === "kostnader" && <Kostnader />}
      </Suspense>
      <ImportSheet />
    </ModulePage>
  );
}
