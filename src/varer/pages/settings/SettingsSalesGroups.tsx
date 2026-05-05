import { Tag } from "lucide-react";
import { StamdataPage } from "@/varer/components/stamdata/StamdataPage";

export default function SettingsSalesGroups() {
  return (
    <StamdataPage
      title="Salgsgrupper"
      description="Gruppering av varer for salg — en vare kan tilhøre flere salgsgrupper."
      icon={Tag}
      tableName="sales_groups"
      auditEntityType="sales_group"
      usageChecks={[{ table: "product_sales_groups", column: "sales_group_id" }]}
    />
  );
}
