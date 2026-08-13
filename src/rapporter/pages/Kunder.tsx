import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Kunder() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Kunder" subtitle="Kundeanalyse med drilldown" icon={Users} />
      <ComingSoonCard phase="R.3" description="Hvem kjøper — med drilldown til hele handlekurven per kunde" icon={Users} />
    </div>
  );
}
