import { useQueryClient } from "@tanstack/react-query";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { CreateRawMaterialFromLine } from "@/fakturaer/components/CreateRawMaterialFromLine";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";
import { StartPriceDialog } from "@/fakturaer/components/StartPriceDialog";
import { BulkCreateRawMaterialsDialog } from "@/fakturaer/components/BulkCreateRawMaterialsDialog";
import { BulkImportRawMaterialsDrawer } from "@/fakturaer/components/BulkImportRawMaterialsDrawer";
import { BulkLinkDialog } from "@/fakturaer/components/BulkLinkDialog";
import type { InvoiceLineQueue } from "./useInvoiceLineQueue";

export type LineDialogKind = "create" | "not_rm" | "conflict" | "start_price" | "bulk_create" | "bulk_import";
export type LineDialog = { kind: LineDialogKind; line: ReviewLineRow | null } | null;

type Props = {
  dialog: LineDialog;
  onClose: () => void;
  q: InvoiceLineQueue;
  canWrite: boolean;
  invoice: { id: string; legal_entity_id: string; supplier_id: string };
  /** «Endre råvare» i inspektøren (fra konfliktdialogen). */
  onEditMaterial: () => void;
};

/** Dialogene inspektøren og masse-handlingene åpner. MatchDrawer brukes ikke her. */
export function LineDialogs({ dialog, onClose, q, canWrite, invoice, onEditMaterial }: Props) {
  const qc = useQueryClient();
  const line = dialog?.line ?? null;
  const is = (k: LineDialogKind) => dialog?.kind === k;
  const close = (v: boolean) => { if (!v) onClose(); };
  const unmatched = q.selectedLines.filter((l) => !l.raw_material_id);
  return (
    <>
      <CreateRawMaterialFromLine open={is("create")} onOpenChange={close} line={line} />
      <NotARawMaterialDialog open={is("not_rm")} onOpenChange={close} line={line} />
      <SkuConflictDialog open={is("conflict")} onOpenChange={close} line={line} onOpenMatchDrawer={() => { onClose(); onEditMaterial(); }} />
      <StartPriceDialog
        open={is("start_price")}
        onOpenChange={close}
        invoiceLineId={line?.id ?? null}
        description={line?.description ?? null}
        rawMaterialName={line?.matched_raw_material?.name ?? null}
        supplierName={line?.invoice.supplier?.name ?? null}
        canWrite={canWrite}
      />
      <BulkCreateRawMaterialsDialog
        open={is("bulk_create")}
        onOpenChange={close}
        lines={q.selectedLines}
        onDone={() => q.setSelected({})}
        onPartial={(ids) => q.setSelected((s) => { const n = { ...s }; for (const id of ids) delete n[id]; return n; })}
      />
      {is("bulk_import") && (
        <BulkImportRawMaterialsDrawer
          open
          onOpenChange={close}
          invoiceId={invoice.id}
          legalEntityId={invoice.legal_entity_id}
          supplierId={invoice.supplier_id}
          lines={unmatched.map((l) => ({
            id: l.id, description: l.description, supplier_sku: l.supplier_sku, quantity: l.quantity, unit: l.unit,
            unit_price: l.unit_price, total_amount: l.total_amount, package_size: l.package_size, package_unit: l.package_unit,
            count_per_package: l.count_per_package,
          }))}
          onComplete={() => { q.setSelected({}); q.refresh(); }}
        />
      )}
      <BulkLinkDialog
        open={!!q.bulkLink}
        onOpenChange={(v) => { if (!v) { q.setBulkLink(null); void qc.invalidateQueries({ queryKey: ["similar-lines-count"] }); } }}
        rmsId={q.bulkLink?.rmsId ?? null}
        rawMaterialName={q.bulkLink?.name ?? ""}
      />
    </>
  );
}
