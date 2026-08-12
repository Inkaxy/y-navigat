import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import type { PreviewRow } from "@/fakturering/hooks/useFakturering";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selected: PreviewRow[];
  onConfirm: () => void;
  isRunning: boolean;
}

export function ConfirmRunDialog({ open, onOpenChange, selected, onConfirm, isRunning }: Props) {
  const totalBasis = selected.reduce((s, r) => s + r.customer_count, 0);
  const totalSum = selected.reduce((s, r) => s + r.sum_excl_vat, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kjør fakturering?</DialogTitle>
          <DialogDescription>
            Oppretter fakturagrunnlag og overfører dem som <strong>ordre-utkast</strong> til Tripletex.
            Ingen faktura sendes fra NBHub — økonomi godkjenner og fakturerer utkastene i Tripletex.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-line-subtle bg-surface-sunken">
          <div className="divide-y divide-line-subtle">
            {selected.map((row) => {
              const def = groupDefFor(row.invoicing_group);
              return (
                <div key={row.invoicing_group ?? "__none"} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{def.code}</span>
                    <span className="font-medium text-text-primary">{def.label}</span>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{row.customer_count} kunder · {row.order_count} ordrer</div>
                    <div className="font-semibold text-text-primary">{formatKr(row.sum_excl_vat)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-line-subtle bg-surface-raised px-4 py-2.5">
            <span className="text-sm font-semibold">Sum (u/mva)</span>
            <span className="font-display text-lg font-semibold tabular-nums">{formatKr(totalSum)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {totalBasis} fakturagrunnlag opprettes. Hver kunde får ett grunnlag med samlede ordrelinjer aggregert per uke.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isRunning}>Avbryt</Button>
          <Button onClick={onConfirm} disabled={isRunning}>
            {isRunning ? "Kjører…" : "Bekreft og kjør"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
