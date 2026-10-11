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
import { GjoreWorkspace } from "@/ravarer/pages/priskontroll/gjore/GjoreWorkspace";
import { useCompany } from "@/hooks/useCompany";
import { PriskontrollToolsMenu } from "./PriskontrollToolsMenu";
import { PRISKONTROLL_TAB_PARAMS, PRISKONTROLL_TABS, priskontrollTabs, RAVARER_EYEBROW } from "./hubTabs";

const Godkjenning = lazy(() => import("@/ravarer/pages/priskontroll/godkjenning/GodkjenningTab").then((m) => ({ default: m.GodkjenningTab })));
const Saker = lazy(() => import("@/ravarer/pages/priskontroll/saker/SakerTab").then((m) => ({ default: m.SakerTab })));

/** Priskontroll: Å gjøre · Fakturaer · Godkjenning · Leverandørsaker. */
export default function PriskontrollPage() {
  const [sp, setSp] = useSearchParams();
  const { search } = useLocation();
  const redirect = normalizePriskontrollSearch(search);
  const tab = activeTabFrom(sp, "fane", [...PRISKONTROLL_TABS], "gjore");
  const { data: summary } = useWorkSummary({ includeApproval: true });
  if (redirect) return <Navigate to={redirect} replace />;
  const openImport = () => setSp((prev) => { const p = new URLSearchParams(prev); p.set("importer", "ehf"); return p; });

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Priskontroll"
      fullBleed
      actions={
        <>
          <PriskontrollToolsMenu />
          <Button size="sm" className="gap-1.5" onClick={openImport}>
            <Upload className="h-3.5 w-3.5" aria-hidden />Importer faktura
          </Button>
        </>
      }
      tabs={<SectionTabs ariaLabel="Priskontroll" tabs={priskontrollTabs(summary)} defaultTab="gjore" clearParams={PRISKONTROLL_TAB_PARAMS} />}
    >
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "gjore" && (
          <GjoreWorkspace />
        )}
        {tab === "fakturaer" && <FakturaerTab />}
        {tab === "godkjenning" && <Godkjenning />}
        {tab === "saker" && <Saker />}
      </Suspense>
      <ImportSheet />
    </ModulePage>
  );
}
