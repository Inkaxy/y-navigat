import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Statistikk() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Statistikk" subtitle="Salgsstatistikk med fritt datointervall" icon={BarChart3} />
      <ComingSoonCard phase="R.3" description="Fleksibel salgsstatistikk per vare/kunde/statistikkgruppe med fritt datointervall og sammenligning" icon={BarChart3} />
    </div>
  );
}
