import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
  /** Kalles når råvaren er opprettet og koblet — etter at brukeren har lukket resultatet. */
  onCreated?: (rawMaterialId: string) => void;
}

/**
 * «Ny råvare …» fra en fakturalinje. Oppretter via varekortet
 * (`link-supplier-item`), slik at alle åpne linjer kobles og regnes om.
 */
export function CreateRawMaterialFromLine({ open, onOpenChange, line, onCreated }: Props) {
  const itemKey = line ? supplierItemKey(line) : null;
  if (!line || !itemKey) return null;
  return (
    <RawMaterialCreateSheet
      open={open}
      onOpenChange={onOpenChange}
      context={{
        kind: "supplier_item",
        supplierId: line.invoice.supplier_id,
        itemKey,
        // Linjen brukes bare til pakningsforslag; ALLE åpne linjer på varekortet kobles.
        inferLineId: line.id,
        lineUnit: line.unit,
        invoiceId: line.invoice_id,
        prefill: {
          name: line.description ?? "",
          sku: line.supplier_sku ?? "",
        },
      }}
      onDone={(id) => { if (id) onCreated?.(id); }}
    />
  );
}
