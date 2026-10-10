import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

/** Grunnenhet foreslått fra fakturaenheten — kan overstyres i skjemaet. */
function baseUnitFromInvoiceUnit(unit: string | null): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (["ml", "cl", "dl", "l", "liter"].includes(u)) return "l";
  if (["stk", "st", "pk", "pakke", "eske", "kart"].includes(u)) return "stk";
  return "kg";
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  line: ReviewLineRow | null;
  /** Kalles når råvaren faktisk ble opprettet eller koblet. */
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
        lineIds: [line.id],
        invoiceId: line.invoice_id,
        prefill: {
          name: line.description ?? "",
          sku: line.supplier_sku ?? "",
          baseUnit: baseUnitFromInvoiceUnit(line.unit),
        },
      }}
      onDone={(id) => { if (id) onCreated?.(id); }}
    />
  );
}
