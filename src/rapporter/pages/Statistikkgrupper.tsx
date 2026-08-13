import { Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Statistikkgrupper() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Statistikkgrupper" subtitle="Analysedimensjon og vareutvalg" icon={Layers} />
      <ComingSoonCard phase="R.1" description="Grupper av varer — analysedimensjon og vareutvalg for NG-filen" icon={Layers} />
    </div>
  );
}
