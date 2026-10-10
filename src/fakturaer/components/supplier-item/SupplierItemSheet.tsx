import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QueryState } from "@/components/common/QueryState";
import { useSupplierItemLines, useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { whatIsMissing, type LinkSupplierItemResult, type SupplierItem, type SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { SupplierItemStatusBadge } from "./SupplierItemStatusBadge";
import { SupplierItemLinkForm } from "./SupplierItemLinkForm";
import { SupplierItemHistory } from "./SupplierItemHistory";

interface Props {
  supplierId: string | null;
  itemKey: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: (r: LinkSupplierItemResult) => void;
  onNext?: () => void;
  /** Kjent rad fra listen — vises mens ferskt varekort hentes. */
  item?: SupplierItem | null;
}

export function SupplierItemSheet({ supplierId, itemKey, open, onOpenChange, onDone, onNext, item: known }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[720px]">
        <SheetHeader className="sr-only"><SheetTitle>Varekort</SheetTitle><SheetDescription>Kobling av leverandørvare til råvare</SheetDescription></SheetHeader>
        {open && <SheetBody supplierId={supplierId} itemKey={itemKey} known={known} onClose={() => onOpenChange(false)} onDone={onDone} onNext={onNext} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ supplierId, itemKey, known, onClose, onDone, onNext }: { supplierId: string | null; itemKey: string | null; known?: SupplierItem | null; onClose: () => void; onDone?: (r: LinkSupplierItemResult) => void; onNext?: () => void }) {
  const q = useSupplierItems({ supplierId, itemKey, pageSize: 1, enabled: !!supplierId && !!itemKey });
  const item = q.data?.items[0] ?? known ?? null;
  const lines = useSupplierItemLines(supplierId, itemKey);
  const { canWrite } = useInvoiceRights();
  return (
    <QueryState isLoading={q.isLoading && !known} isError={q.isError} error={q.error} scope="fakturaer:varekort" onRetry={() => void q.refetch()} isEmpty={!item} emptyTitle="Fant ikke varekortet">
      {item && <SupplierItemView item={item} linesQuery={lines} canWrite={canWrite} onClose={onClose} onDone={onDone} onNext={onNext} />}
    </QueryState>
  );
}

export function SupplierItemView({ item, linesQuery, canWrite = true, onClose, onDone, onNext }: {
  item: SupplierItem;
  linesQuery: { data?: SupplierItemLine[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  canWrite?: boolean;
  onClose: () => void;
  onDone?: (r: LinkSupplierItemResult) => void;
  onNext?: () => void;
}) {
  const lines = linesQuery.data ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-caption text-ink-secondary">{item.supplier_name ?? "Ukjent leverandør"}{item.supplier_sku ? ` · varenr. ${item.supplier_sku}` : ""}</p>
        <h2 className="font-display text-xl">{item.description ?? "Uten beskrivelse"}</h2>
        <SupplierItemStatusBadge status={item.status} />
      </header>
      <section className="rounded-md bg-muted/40 p-3">
        <h3 className="text-caption font-semibold text-ink-secondary">Hva mangler</h3>
        <p className="mt-1 text-sm">{whatIsMissing(item)}</p>
        {item.rms_notes && <p className="mt-2 text-caption text-ink-secondary">{item.rms_notes}</p>}
      </section>
      <QueryState isLoading={linesQuery.isLoading} isError={linesQuery.isError} error={linesQuery.error} scope="fakturaer:varekort-linjer" onRetry={() => void linesQuery.refetch()}>
        <SupplierItemLinkForm key={`${item.supplier_id}|${item.item_key}`} item={item} lines={lines} canWrite={canWrite} onClose={onClose} onDone={onDone} onNext={onNext} />
        <section>
          <h3 className="mb-1 text-sm font-semibold">Historikk</h3>
          {lines.length === 0 ? <p className="text-sm text-ink-secondary">Ingen linjer funnet.</p> : <SupplierItemHistory lines={lines} baseUnit={item.rm_base_unit} />}
        </section>
      </QueryState>
    </div>
  );
}
