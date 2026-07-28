import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Paperclip, RotateCw, Loader2 } from "lucide-react";
import {
  useBasisDetails,
  getAttachmentSignedUrl,
  regenerateAttachment,
  useHasFakturaWriteAccess,
  type BasisRow,
} from "@/fakturering/hooks/useFakturering";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { formatKr } from "@/fakturering/lib/groups";
import { BasisStatusChip, tripletexInvoiceUrl, tripletexOrderUrl } from "./BasisStatusChip";

interface Props {
  basis: BasisRow | null;
  onOpenChange: (open: boolean) => void;
}

export function BasisDetailsDrawer({ basis, onOpenChange }: Props) {
  const open = !!basis;
  const details = useBasisDetails(basis?.id, open);

  const txUrl = basis?.tripletex_invoice_id
    ? tripletexInvoiceUrl(basis.tripletex_invoice_id)
    : tripletexOrderUrl(basis?.tripletex_order_id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {basis && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <span className="font-mono">{basis.basis_number}</span>
                <BasisStatusChip
                  status={basis.status}
                  invoiceNumber={basis.tripletex_invoice_number}
                  errorMessage={basis.transfer_error}
                  doTransfer={basis.do_transfer}
                />
              </SheetTitle>
              <SheetDescription>
                {basis.customer?.display_name ?? "—"} ({basis.customer?.customer_number ?? "?"})
                {txUrl && (
                  <>
                    {" · "}
                    <a href={txUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--app-primary))] underline">
                      Åpne i Tripletex ↗
                    </a>
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            {basis.transfer_error && basis.status === "error" && (
              <div className="mt-4 rounded-md border border-red-400/40 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
                {basis.transfer_error}
              </div>
            )}

            <section className="mt-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Linjer ({details.data?.lines.length ?? 0})
              </h3>
              <div className="overflow-hidden rounded-lg border border-line-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Uke</th>
                      <th className="px-3 py-2 text-left font-semibold">Varenr</th>
                      <th className="px-3 py-2 text-left font-semibold">Beskrivelse</th>
                      <th className="px-3 py-2 text-right font-semibold">Ant.</th>
                      <th className="px-3 py-2 text-right font-semibold">Pris</th>
                      <th className="px-3 py-2 text-right font-semibold">Mva</th>
                      <th className="px-3 py-2 text-right font-semibold">Sum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {(details.data?.lines ?? []).map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{l.iso_week ?? "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{l.product_number ?? ""}</td>
                        <td className="px-3 py-1.5">{l.description}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.quantity).toLocaleString("no-NB")}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.unit_price_excl_vat != null ? formatKr(Number(l.unit_price_excl_vat)) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.vat_rate)} %</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatKr(Number(l.line_incl_vat))}</td>
                      </tr>
                    ))}
                    {!details.isLoading && (details.data?.lines.length ?? 0) === 0 && (
                      <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Ingen linjer.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Ordrer i grunnlaget ({details.data?.orders.length ?? 0})
              </h3>
              <div className="overflow-hidden rounded-lg border border-line-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Ordre</th>
                      <th className="px-3 py-2 text-left font-semibold">Leveringsdato</th>
                      <th className="px-3 py-2 text-right font-semibold">Sum inkl. mva</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {(details.data?.orders ?? []).map((o) => (
                      <tr key={o.order_id}>
                        <td className="px-3 py-1.5">
                          <Link to={`/ordre/${o.order_id}`} className="font-medium text-[hsl(var(--app-primary))] hover:underline">
                            {o.order_number ?? o.order_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                          {o.delivery_date ? format(new Date(o.delivery_date), "dd.MM.yyyy") : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{o.total_incl_vat != null ? formatKr(Number(o.total_incl_vat)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 grid grid-cols-3 gap-3 rounded-lg border border-line-subtle bg-surface-sunken p-4 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sum eks. mva</div>
                <div className="font-semibold tabular-nums">{formatKr(Number(basis.sum_excl_vat))}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Mva</div>
                <div className="font-semibold tabular-nums">{formatKr(Number(basis.sum_vat))}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sum ink. mva</div>
                <div className="font-semibold tabular-nums">{formatKr(Number(basis.sum_incl_vat))}</div>
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
