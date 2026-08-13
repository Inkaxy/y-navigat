import { History } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComingSoonCard } from "@/rapporter/components/ComingSoonCard";

export default function Historikk() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Rapporter" title="Historikk" subtitle="Arkiv over genererte rapporter" icon={History} />
      <ComingSoonCard phase="R.2" description="Arkiv over alle genererte rapporter, med nedlasting og diff" icon={History} />
    </div>
  );
}
