import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, PackageCheck, PackagePlus } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useReceiptInvoices, type ReceiptInvoiceRow } from "@/ravarer/hooks/useGoodsReceipt";
import { QueryState } from "@/components/common/QueryState";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { osloDateISOPlusDays, osloTodayISO } from "@/lib/osloDate";
import { paths } from "@/ravarer/lib/paths";
import { InvoiceReceiptPanel } from "./varemottak/InvoiceReceiptPanel";
import { ManualReceiptDialog } from "./varemottak/ManualReceiptDialog";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Varemottak: periode/leverandør/valgt faktura ligger i adressen (`fra`, `til`, `leverandor`, `valgt`). */
export default function Varemottak() {
  const { canWrite } = useRavarer();
  const [sp, setSp] = useSearchParams();
  const fromRaw = sp.get("fra");
  const toRaw = sp.get("til");
  const fromDate = fromRaw && ISO.test(fromRaw) ? fromRaw : osloDateISOPlusDays(-14);
  const toDate = toRaw && ISO.test(toRaw) ? toRaw : osloTodayISO();
  const supplierId = sp.get("leverandor") ?? "all";
  const openInvoiceId = sp.get("valgt");
  const [manualOpen, setManualOpen] = useState(false);
  const setParam = (k: string, v: string | null) =>
    setSp(prev => {
      const p = new URLSearchParams(prev);
      if (v) p.set(k, v);
      else p.delete(k);
      return p;
    }, { replace: k !== "valgt" });

  const { data: suppliers = [] } = useSuppliers();
  const invoicesQuery = useReceiptInvoices({ fromDate, toDate, supplierId: supplierId === "all" ? null : supplierId });
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);
  const evidenceError = invoices.some(i => i.evidence_error);
  const totals = useMemo(
    () => ({
      invoices: invoices.length,
      confirmed: invoices.reduce((s, i) => s + i.confirmed_lines, 0),
      waiting: invoices.reduce((s, i) => s + i.open_lines + i.movement_only_lines, 0),
    }),
    [invoices],
  );
  const openInvoice = invoices.find(i => i.id === openInvoiceId) ?? null;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Fakturaer i perioden</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{invoicesQuery.isSuccess ? totals.invoices : "–"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Linjer bekreftet mottatt</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{invoicesQuery.isSuccess && !evidenceError ? totals.confirmed : "–"}</p>
        </Card>
        <Card className={`p-4 ${totals.waiting > 0 ? "border-warning/50" : ""}`}>
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Venter på mottak</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${totals.waiting > 0 ? "text-warning" : ""}`}>
            {invoicesQuery.isSuccess && !evidenceError ? totals.waiting : "–"}
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto">
            <Label className="text-xs" htmlFor="vm-fra">Fra dato</Label>
            <Input id="vm-fra" type="date" value={fromDate} onChange={e => setParam("fra", e.target.value || null)} className="h-[44px] sm:w-[160px]" />
          </div>
          <div className="w-full sm:w-auto">
            <Label className="text-xs" htmlFor="vm-til">Til dato</Label>
            <Input id="vm-til" type="date" value={toDate} onChange={e => setParam("til", e.target.value || null)} className="h-[44px] sm:w-[160px]" />
          </div>
          <div className="w-full sm:w-auto">
            <Label className="text-xs">Leverandør</Label>
            <Select value={supplierId} onValueChange={v => setParam("leverandor", v === "all" ? null : v)}>
              <SelectTrigger className="h-[44px] sm:w-[220px]" aria-label="Leverandør"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle leverandører</SelectItem>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            {canWrite && (
              <Button className="min-h-[44px] w-full" onClick={() => setManualOpen(true)}>
                <PackagePlus className="mr-1.5 h-4 w-4" aria-hidden /> Manuelt mottak
              </Button>
            )}
          </div>
        </div>
      </Card>

      {evidenceError && (
        <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          Mottaks- eller lagerstatus kunne ikke hentes for alle linjer. Tallene vises ikke før de er kjent.{" "}
          <button className="min-h-[44px] underline" onClick={() => void invoicesQuery.refetch()}>Prøv igjen</button>
        </p>
      )}

      <Card className="overflow-hidden">
        {invoicesQuery.isLoading || invoicesQuery.isError || invoices.length === 0 ? (
          <div className="p-6">
            <QueryState
              scope="ravarer:varemottak"
              isLoading={invoicesQuery.isLoading}
              isError={invoicesQuery.isError}
              error={invoicesQuery.error}
              isEmpty={invoices.length === 0}
              onRetry={() => void invoicesQuery.refetch()}
              emptyTitle="Ingen fakturaer i perioden."
            />
          </div>
        ) : (
          <>
            <p className="border-b border-line-subtle px-4 py-2 text-xs text-ink-secondary">Alle {invoices.length} fakturaer i perioden vises.</p>
            <ul className="divide-y divide-line-subtle md:hidden" aria-label="Fakturaer">
              {invoices.map(inv => (
                <li key={inv.id}>
                  <button className="block min-h-[44px] w-full p-4 text-left" onClick={() => setParam("valgt", inv.id)}>
                    <span className="flex justify-between gap-2">
                      <span className="font-mono text-xs">{inv.invoice_number}</span>
                      <span className="text-xs text-ink-secondary">{formatDate(inv.invoice_date)}</span>
                    </span>
                    <span className="mt-1 block break-words text-sm">{inv.supplier_name ?? "Ukjent leverandør"}</span>
                    <span className="mt-2 block"><StatusBadges inv={inv} /></span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    <th className="px-4 py-3">Faktura</th>
                    <th className="px-4 py-3">Dato</th>
                    <th className="px-4 py-3">Leverandør</th>
                    <th className="px-4 py-3 text-right">Beløp</th>
                    <th className="px-4 py-3">Mottaksstatus</th>
                    <th className="px-4 py-3"><span className="sr-only">Handling</span></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className={`border-t border-line-subtle ${inv.id === openInvoiceId ? "bg-muted/40" : ""}`}>
                      <td className="px-4 py-3">
                        <Link to={paths.faktura(inv.id)} className="font-mono text-xs text-primary hover:underline">{inv.invoice_number}</Link>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3">{inv.supplier_name ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNok(inv.total_amount)}</td>
                      <td className="px-4 py-3"><StatusBadges inv={inv} /></td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setParam("valgt", inv.id)}>Se mottak</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <InvoiceReceiptPanel invoiceId={openInvoiceId} invoiceNumber={openInvoice?.invoice_number ?? ""} onClose={() => setParam("valgt", null)} canWrite={canWrite} />
      <ManualReceiptDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
}

function StatusBadges({ inv }: { inv: ReceiptInvoiceRow }) {
  if (inv.evidence_error) return <Badge variant="outline" className="border-warning/50 text-warning">Status ukjent</Badge>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {inv.is_credit_note && <Badge variant="outline">Kreditnota</Badge>}
      <Badge variant="outline" className="text-success">
        <PackageCheck className="mr-1 h-3 w-3" aria-hidden /> {inv.confirmed_lines} mottatt
      </Badge>
      {inv.movement_only_lines > 0 && (
        <Badge variant="outline" className="border-warning/50 text-warning">{inv.movement_only_lines} på lager, ikke bekreftet</Badge>
      )}
      {inv.open_lines > 0 && (
        <Badge variant="outline" className="border-warning/50 text-warning">
          <AlertTriangle className="mr-1 h-3 w-3" aria-hidden /> {inv.open_lines} venter
        </Badge>
      )}
      {inv.untracked_lines > 0 && <Badge variant="outline" className="text-ink-secondary">{inv.untracked_lines} uten lager</Badge>}
    </span>
  );
}
