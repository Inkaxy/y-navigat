import { lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { paths } from "@/ravarer/lib/paths";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { activeTabFrom } from "@/ravarer/ui/sectionTabsLogic";
import { cn } from "@/lib/utils";
import { FakturaerStripe } from "./FakturaerStripe";
import { PriskontrollToolsMenu } from "./PriskontrollToolsMenu";
import { PRISKONTROLL_TAB_PARAMS, PRISKONTROLL_TABS, priskontrollTabs, RAVARER_EYEBROW } from "./hubTabs";

const Varekoblinger = lazy(() => import("@/fakturaer/pages/Varekoblinger"));
const Innboks = lazy(() => import("@/fakturaer/pages/ReviewQueue"));
const AlleFakturaer = lazy(() => import("@/fakturaer/pages/FakturaerList"));
const Godkjenning = lazy(() => import("@/fakturaer/pages/InvoiceOverview"));
const Saker = lazy(() => import("@/fakturaer/pages/SupplierCases"));

function VisningToggle({ value }: { value: "innboks" | "alle" }) {
  const opt = (v: "innboks" | "alle", label: string) => (
    <Link
      to={v === "innboks" ? paths.fakturaInnboks() : paths.alleFakturaer()}
      replace
      aria-current={value === v ? "page" : undefined}
      className={cn("rounded-md px-3 py-1 text-sm", value === v ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );
  return (
    <div role="group" aria-label="Visning" className="inline-flex gap-1 rounded-lg bg-muted p-1">
      {opt("innboks", "Innboks")}
      {opt("alle", "Alle fakturaer")}
    </div>
  );
}

/** Priskontroll: Å gjøre · Fakturaer · Godkjenning · Leverandørsaker. */
export default function PriskontrollPage() {
  const [sp] = useSearchParams();
  const tab = activeTabFrom(sp, "fane", [...PRISKONTROLL_TABS], "gjore");
  const { data: summary } = useWorkSummary({ includeApproval: tab === "godkjenning" });
  const visning = sp.get("visning") === "alle" ? "alle" : "innboks";

  return (
    <ModulePage
      eyebrow={RAVARER_EYEBROW}
      title="Priskontroll"
      fullBleed
      actions={
        <>
          <PriskontrollToolsMenu />
          <Button asChild size="sm" className="gap-1.5">
            <Link to={paths.importFaktura()}><Upload className="h-3.5 w-3.5" aria-hidden />Importer faktura</Link>
          </Button>
        </>
      }
      tabs={<SectionTabs ariaLabel="Priskontroll" tabs={priskontrollTabs(summary)} defaultTab="gjore" clearParams={PRISKONTROLL_TAB_PARAMS} />}
    >
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "gjore" && (
          <>
            <FakturaerStripe />
            <Varekoblinger />
          </>
        )}
        {tab === "fakturaer" && (
          <>
            <VisningToggle value={visning} />
            {visning === "alle" ? <AlleFakturaer /> : <Innboks />}
          </>
        )}
        {tab === "godkjenning" && <Godkjenning />}
        {tab === "saker" && <Saker />}
      </Suspense>
    </ModulePage>
  );
}
