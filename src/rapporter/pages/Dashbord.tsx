import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Dashbord() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Dashbord" subtitle="Nøkkeltall for salget" icon={LayoutDashboard} />
      <ComingSoonCard phase="R.4" description="KPI-er for salg (netto, YoY, YTD, MoM), trend mot i fjor, topp 10 varer og kunder" icon={LayoutDashboard} />
    </div>
  );
}
