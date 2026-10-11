import { RawMaterialDetailHeader } from "@/ravarer/components/detail/RawMaterialDetailHeader";

/** Skrivebeskyttet fixture: råvarekortets produksjonshode med langt navn (ingen data, ingen nettverk). */
export default function HeaderPreviewContent() {
  const noop = () => undefined;
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-3 md:p-6">
      <RawMaterialDetailHeader
        rm={{ name: "Idun Combisur Soft sekk 20kg", sku: "RV-IDUN-COMBISUR-SOFT-20", base_unit: "kg", item_type: "ravare", is_active: true }}
        listSearch="q=combisur"
        canPrev={false}
        canNext
        showRename
        onBack={noop}
        onPrev={noop}
        onNext={noop}
        onRename={noop}
      />
    </div>
  );
}
