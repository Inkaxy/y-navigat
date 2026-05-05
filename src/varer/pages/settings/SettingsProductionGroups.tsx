import { Factory } from "lucide-react";
import { StamdataPage } from "@/varer/components/stamdata/StamdataPage";

export default function SettingsProductionGroups() {
  return (
    <StamdataPage
      title="Produksjonsgrupper"
      description="Varer som bakes sammen grupperes her. Én vare kan være 'hovedvare' for gruppen."
      icon={Factory}
      tableName="production_groups"
      auditEntityType="production_group"
      usageChecks={[{ table: "products", column: "production_group_id" }]}
    />
  );
}
