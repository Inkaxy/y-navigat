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
import { readEdgeError } from "@/fakturering/lib/edgeError";

interface Props {
  basis: BasisRow | null;
  onOpenChange: (open: boolean) => void;
}

export function BasisDetailsDrawer({ basis, onOpenChange }: Props) {
  const open = !!basis;
  const details = useBasisDetails(basis?.id, open);
  const { toast } = useToast();
  const qc = useQueryClient();
  const writeAccess = useHasFakturaWriteAccess();
  const [busy, setBusy] = useState<"open" | "regen" | null>(null);

  const txUrl = basis?.tripletex_invoice_id
    ? tripletexInvoiceUrl(basis.tripletex_invoice_id)
    : tripletexOrderUrl(basis?.tripletex_order_id);

  async function openAttachment() {
    if (!basis?.attachment_path) return;
    setBusy("open");
    try {
      const url = await getAttachmentSignedUrl(basis.attachment_path, 60);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast({ title: "Kunne ikke åpne vedlegg", description: await readEdgeError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function regen() {
    if (!basis) return;
    setBusy("regen");
    try {
      await regenerateAttachment({ basis_id: basis.id });
      toast({ title: "Vedlegg generert på nytt" });
      qc.invalidateQueries({ queryKey: ["fakturering"] });
    } catch (e: any) {
      toast({ title: "Feilet", description: await readEdgeError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }


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

            {/* Vedlegg (PDF) */}
            <section className="mt-4 rounded-lg border border-line-subtle bg-surface-sunken p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Vedlegg (PDF)</span>
                <span className="text-xs text-muted-foreground">
                  {basis.attachment_path
                    ? `Generert ${basis.attachment_generated_at ? format(new Date(basis.attachment_generated_at), "dd.MM HH:mm") : ""}`
                    : basis.attachment_error?.includes("ikke aktuelt")
                      ? "ikke aktuelt (ingen leveranselinjer)"
                      : basis.attachment_generated_at
                        ? "genereringsfeil — se detaljer"
                        : "genereres …"}
                </span>
                <div className="ml-auto flex gap-2">
                  {basis.attachment_path && (
                    <button
                      onClick={openAttachment}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--app-primary))] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[hsl(var(--app-primary)/0.9)] disabled:opacity-50"
                    >
                      {busy === "open" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Åpne vedlegg
                    </button>
                  )}
                  {writeAccess.data && (
                    <button
                      onClick={regen}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-md border border-line-subtle bg-surface-raised px-3 py-1.5 text-xs font-semibold hover:bg-surface-sunken disabled:opacity-50"
                    >
                      <RotateCw className={busy === "regen" ? "h-3 w-3 animate-spin" : "h-3 w-3"} /> Generer på nytt
                    </button>
                  )}
                </div>
              </div>
              {basis.attachment_error && !basis.attachment_error.includes("ikke aktuelt") && (
                <div className="mt-2 text-xs text-red-700 dark:text-red-400">{basis.attachment_error}</div>
              )}
            </section>


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
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.quantity).toLocaleString("nb-NO")}</td>
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
