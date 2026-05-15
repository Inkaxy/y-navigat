import { Factory } from "lucide-react";
import { StamdataPage } from "@/varer/components/stamdata/StamdataPage";

export default function SettingsProductionGroups() {
  return (
    <StamdataPage
      title="Produksjonsgrupper"
      description="Varer som bakes sammen grupperes her. Velg gjerne en 'hovedvare' — den brukes når produksjonsplanen skal slå sammen ulike pakke-varianter til én linje."
      icon={Factory}
      tableName="production_groups"
      auditEntityType="production_group"
      usageChecks={[{ table: "products", column: "production_group_id" }]}
      extraProductPicker={{
        key: "main_product_id",
        label: "Hovedvare (for sammenslåing på produksjonsplan)",
        productFilterColumn: "production_group_id",
        activeOnly: false,
      }}
    />
  );
}
