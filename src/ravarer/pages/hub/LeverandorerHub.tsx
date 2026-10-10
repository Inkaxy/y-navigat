import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { activeTabFrom } from "@/ravarer/ui/sectionTabsLogic";
import { leverandorTabs, RAVARER_EYEBROW } from "./hubTabs";

const Leverandorer = lazy(() => import("@/ravarer/pages/Leverandorer"));
const Avtaler = lazy(() => import("@/ravarer/pages/Avtaler"));
const Forhandlinger = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingerList"));

export default function LeverandorerHub() {
  const [sp] = useSearchParams();
  const { data: hasInvoiceAccess = false } = useInvoiceAccess();
  const { data: summary } = useWorkSummary({ includeApproval: false });
  const tabs = leverandorTabs(summary, hasInvoiceAccess);
  const tab = activeTabFrom(sp, "fane", tabs.filter((t) => !t.hidden).map((t) => t.id), "leverandorer");
  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Leverandører" tabs={<SectionTabs ariaLabel="Leverandører" tabs={tabs} defaultTab="leverandorer" />}>
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "leverandorer" && <Leverandorer />}
        {tab === "avtaler" && <Avtaler />}
        {tab === "forhandlinger" && hasInvoiceAccess && <Forhandlinger />}
      </Suspense>
    </ModulePage>
  );
}
