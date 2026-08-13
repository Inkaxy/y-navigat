import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Trender() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Trender" subtitle="Utvikling opp og ned, med oppfølgingsliste" icon={TrendingUp} />
      <ComingSoonCard phase="R.3" description="Hva solgte vi mer av, hva solgte vi mindre av, kunder som kjøpte mer/mindre, oppfølgingsliste" icon={TrendingUp} />
    </div>
  );
}
