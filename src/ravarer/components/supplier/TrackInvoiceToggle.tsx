import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBackfillSupplierInvoices, useSetTrackInvoiceLines, type SupplierRow } from "@/ravarer/hooks/useSuppliers";

export const TRACK_HELP_SHORT =
  "På: fakturaene hentes fra Tripletex og varelinjene leses. Bare kontrollerte priser brukes i kalkyler. Av: ingen fakturaer hentes.";

/**
 * «Følg fakturalinjer». Påslag krever bekreftelse og starter 12 måneders henting for nøyaktig denne
 * leverandøren; avslag sletter ingenting. Aldri henting ved visning eller filtervalg.
 */
export function TrackInvoiceToggle({ supplier, canWrite }: { supplier: Pick<SupplierRow, "id" | "name" | "track_invoice_lines">; canWrite: boolean }) {
  const setTracking = useSetTrackInvoiceLines();
  const backfill = useBackfillSupplierInvoices();
  const [confirm, setConfirm] = useState(false);

  async function enable() {
    setConfirm(false);
    try {
      await setTracking.mutateAsync({ id: supplier.id, value: true });
    } catch {
      return; // feilen vises av mutasjonen; ingen henting startes
    }
    toast.info(`Henter 12 måneder med fakturaer fra ${supplier.name}…`);
    backfill.mutate({ supplierId: supplier.id, months: 12 });
  }

  return (
    <>
      <label className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center md:min-h-0 md:min-w-0" onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={!!supplier.track_invoice_lines}
          disabled={!canWrite || setTracking.isPending || backfill.isPending}
          onCheckedChange={(value) => {
            if (value) setConfirm(true);
            else setTracking.mutate({ id: supplier.id, value: false });
          }}
          aria-label={`Følg fakturalinjer for ${supplier.name}`}
        />
      </label>
      <AlertDialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Følg fakturaer fra {supplier.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Det siste årets fakturaer hentes fra Tripletex, og varelinjene leses ut. Nye fakturaer hentes automatisk framover.
              Prisene kontrolleres før de brukes i kalkyler. Skrur du den av igjen, slettes ingenting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => void enable()}>Slå på og hent 12 måneder</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SupplierStatusBadge({ s }: { s: Pick<SupplierRow, "is_active" | "tripletex_is_inactive"> }) {
  if (s.tripletex_is_inactive) return <span className="rounded-md border border-line-subtle px-1.5 py-0.5 text-caption text-ink-secondary">Inaktiv i Tripletex</span>;
  if (s.is_active) return <span className="rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-caption text-success">Aktiv</span>;
  return <span className="rounded-md border border-line-subtle px-1.5 py-0.5 text-caption text-ink-secondary">Inaktiv</span>;
}
