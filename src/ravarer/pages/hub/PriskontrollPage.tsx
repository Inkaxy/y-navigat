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
import { Arbeidsbord } from "@/ravarer/pages/priskontroll/arbeidsbord/Arbeidsbord";
import { FakturaArbeid } from "@/ravarer/pages/priskontroll/arbeid/FakturaArbeid";
import { MengdeDiagnostikk } from "@/ravarer/pages/priskontroll/gjore/mengde/MengdeDiagnostikk";
import { Link } from "react-router-dom";
import { PriskontrollToolsMenu } from "./PriskontrollToolsMenu";
import { PRISKONTROLL_TAB_PARAMS, PRISKONTROLL_TABS, priskontrollTabs, RAVARER_EYEBROW } from "./hubTabs";

const Godkjenning = lazy(() => import("@/ravarer/pages/priskontroll/godkjenning/GodkjenningTab").then((m) => ({ default: m.GodkjenningTab })));
const Saker = lazy(() => import("@/ravarer/pages/priskontroll/saker/SakerTab").then((m) => ({ default: m.SakerTab })));

/** Priskontroll: Fakturaer (arbeidsflate) · Fakturaliste · Varegrupper · Godkjenning · Leverandørsaker. */
export default function PriskontrollPage() {
  const [sp, setSp] = useSearchParams();
  const { search } = useLocation();
  const redirect = normalizePriskontrollSearch(search);
  // Gamle lenker uten `fane` men med varegruppeparametre (`visning`, `valgt`) gjaldt «Å gjøre» — de beholder den visningen.
  const legacyGjore = !sp.get("fane") && (sp.has("visning") || sp.has("valgt"));
  const tab = legacyGjore ? "gjore" : activeTabFrom(sp, "fane", [...PRISKONTROLL_TABS], "arbeid");
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
      tabs={<SectionTabs ariaLabel="Priskontroll" tabs={priskontrollTabs(summary, tab)} defaultTab="arbeid" activeId={tab} clearParams={PRISKONTROLL_TAB_PARAMS} />}
    >
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "gjore" && sp.get("visning") === "mengde" && <MengdeDiagnostikk />}
        {tab === "gjore" && !sp.get("visning") && <Arbeidsbord />}
        {tab === "gjore" && sp.get("visning") && sp.get("visning") !== "mengde" && (
          <>
            <div className="px-page pb-2">
              <Link to="?fane=gjore" className="inline-flex min-h-[44px] items-center text-sm text-ink-secondary underline-offset-2 hover:underline">
                Til det nye arbeidsbordet
              </Link>
            </div>
            <GjoreWorkspace />
            <div className="px-page pb-4">
              <Link to="?fane=gjore&visning=mengde" className="inline-flex min-h-[44px] items-center text-sm text-ink-secondary underline-offset-2 hover:underline">
                Diagnostikk: linjer uten mengde i baseenhet
              </Link>
            </div>
          </>
        )}
        {tab === "arbeid" && <FakturaArbeid />}
        {tab === "fakturaer" && <FakturaerTab />}
        {tab === "godkjenning" && <Godkjenning />}
        {tab === "saker" && <Saker />}
      </Suspense>
      <ImportSheet />
    </ModulePage>
  );
}
