import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function NgEksport() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="NG-eksport" subtitle="Månedlig salgsfil til NorgesGruppen" icon={FileDown} />
      <ComingSoonCard phase="R.2" description="Månedlig DirekteLevert-fil til NorgesGruppen med validering og arkiv" icon={FileDown} />
    </div>
  );
}
