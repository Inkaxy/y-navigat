import { GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Sammenligning() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Sammenligning" subtitle="To perioder side ved side" icon={GitCompareArrows} />
      <ComingSoonCard phase="R.3" description="To vilkårlige perioder side ved side, måned for måned med Δ, % og YTD" icon={GitCompareArrows} />
    </div>
  );
}
