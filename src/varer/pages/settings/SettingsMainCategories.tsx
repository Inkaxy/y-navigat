import { FolderOpen } from "lucide-react";
import { StamdataPage } from "@/varer/components/stamdata/StamdataPage";

export default function SettingsMainCategories() {
  return (
    <StamdataPage
      title="Hovedvaregrupper"
      description="Øverste nivå i varekategoriseringen. Eksempel: B (Brød), K (Konditor), D (Diverse)."
      icon={FolderOpen}
      tableName="product_main_categories"
      auditEntityType="product_main_category"
      usageChecks={[{ table: "products", column: "main_category_id" }]}
    />
  );
}
