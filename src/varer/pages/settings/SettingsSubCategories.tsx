import { Folder } from "lucide-react";
import { StamdataPage, type StamdataRow } from "@/components/stamdata/StamdataPage";

export default function SettingsSubCategories() {
  return (
    <StamdataPage
      title="Undervaregrupper"
      description="Nivå 2 i varekategoriseringen, knyttet til en hovedgruppe. Eksempel: B11 (Skåret brød) under B."
      icon={Folder}
      tableName="product_sub_categories"
      auditEntityType="product_sub_category"
      usageChecks={[{ table: "products", column: "sub_category_id" }]}
      extraFields={[
        {
          key: "main_category_id",
          label: "Hovedvaregruppe",
          lookupTable: "product_main_categories",
          activeOnly: true,
          required: true,
        },
      ]}
      extraColumns={[
        {
          header: "Hovedgruppe",
          render: (row: StamdataRow, lookups) => {
            const list = lookups["product_main_categories"] ?? [];
            const main = list.find((m) => m.id === row.main_category_id);
            return main ? (
              <span className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">{main.code}</span>{" "}
                {main.display_name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
          },
        },
      ]}
    />
  );
}
