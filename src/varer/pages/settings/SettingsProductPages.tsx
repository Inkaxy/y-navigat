import { LayoutGrid } from "lucide-react";
import { StamdataPage } from "@/varer/components/stamdata/StamdataPage";

export default function SettingsProductPages() {
  return (
    <StamdataPage
      title="Varesider"
      description="Kategorier for nettsidepresentasjon. Avgjør hvor varen vises på nettsiden."
      icon={LayoutGrid}
      tableName="product_pages"
      auditEntityType="product_page"
      usageChecks={[{ table: "products", column: "product_page_id" }]}
    />
  );
}
