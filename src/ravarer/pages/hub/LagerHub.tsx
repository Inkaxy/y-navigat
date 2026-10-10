import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { activeTabFrom } from "@/ravarer/ui/sectionTabsLogic";
import { lagerTabs, RAVARER_EYEBROW } from "./hubTabs";

const Lager = lazy(() => import("@/ravarer/pages/Lager"));
const Varemottak = lazy(() => import("@/ravarer/pages/Varemottak"));
const Varetelling = lazy(() => import("@/ravarer/pages/Varetelling"));

export default function LagerHub() {
  const [sp] = useSearchParams();
  const { data: summary } = useWorkSummary({ includeApproval: false });
  const tab = activeTabFrom(sp, "fane", ["beholdning", "varemottak", "telling"], "beholdning");
  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Lager" tabs={<SectionTabs ariaLabel="Lager" tabs={lagerTabs(summary)} defaultTab="beholdning" />}>
      <Suspense fallback={<QueryLoadingState rows={6} />}>
        {tab === "beholdning" && <Lager />}
        {tab === "varemottak" && <Varemottak />}
        {tab === "telling" && <Varetelling />}
      </Suspense>
    </ModulePage>
  );
}
