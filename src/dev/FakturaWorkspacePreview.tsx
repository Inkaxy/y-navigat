import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { deliverySteps, nextInvoiceStep, type DeliveryInvoice, type DeliveryExtras } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import "@/index.css";

/** Forhåndsvisning med faste testdata — ingen serverkall. */
type Row = { supplier: string; no: string; amount: string; inv: DeliveryInvoice; ex: DeliveryExtras; source: string; canReconcile: boolean };
const base: DeliveryInvoice = { status: "pending", received_at: "2026-10-08", line_count: 6, open_count: 0, lines_sum_status: "ok" };
const ROWS: Row[] = [
  { supplier: "Bama Storkjøkken", no: "99102", amount: "6 420,00", inv: { ...base, line_count: 0, lines_sum_status: null }, ex: { approved: false, costPosted: false }, source: "tripletex", canReconcile: false },
  { supplier: "A/S PALS", no: "526301", amount: "18 452,00", inv: { ...base, lines_sum_status: "mismatch" }, ex: { approved: false, costPosted: false }, source: "tripletex", canReconcile: false },
  { supplier: "Diplom-Is AS", no: "771204", amount: "4 312,50", inv: { ...base, open_count: 2 }, ex: { approved: false, costPosted: false }, source: "tripletex", canReconcile: false },
  { supplier: "Idun Industri AS", no: "1515620", amount: "33 120,00", inv: base, ex: { approved: false, costPosted: false }, source: "tripletex", canReconcile: true },
  { supplier: "Tine SA", no: "88123", amount: "9 880,00", inv: { ...base, status: "reconciled", reconciled_mode: "auto" }, ex: { approved: false, costPosted: false }, source: "tripletex", canReconcile: true },
  { supplier: "Engrospartner", no: "40021", amount: "12 004,00", inv: { ...base, status: "reconciled" }, ex: { approved: true, costPosted: true }, source: "ehf", canReconcile: true },
];
const step = (r: Row) => nextInvoiceStep({ ...r.inv, ...r.ex, source: r.source, canReconcile: r.canReconcile, reconcileBlockedReason: null, canWrite: true, canReconcileRight: true, canApprove: true });

const LINES = [
  { sku: "40213", desc: "SOFTISMIKS UHT 5L DIPLOM-IS", rm: "Softismiks", qty: "4", unit: "kanne", price: "392,00", sum: "1 568,00", exp: "350,65 (avtale)", dev: "+11,8 %", status: "Prisavvik" },
  { sku: "1182", desc: "KARDEMOMME 1 HT VARMEBE.", rm: "Ikke koblet", qty: "2", unit: "pose", price: "406,00", sum: "812,00", exp: "—", dev: "—", status: "Mangler råvare" },
];
const ws = ROWS[2];

function App() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-10">
      <section className="space-y-3">
        <h1 className="font-display text-title">Fakturaer · Trenger meg</h1>
        <div className="flex flex-wrap gap-2">{["Trenger meg 3", "Klare til avstemming 1", "Avstemt 2", "Alle 6"].map((c, i) => <Badge key={c} variant={i === 0 ? "default" : "outline"}>{c}</Badge>)}</div>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {ROWS.map((r) => {
            const s = step(r);
            return (
              <div key={r.no} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-4">
                <div className="min-w-0 flex-1"><p className="font-medium truncate">{r.supplier}</p><p className="text-caption text-muted-foreground">Faktura {r.no} · kr {r.amount}</p></div>
                <DeliveryTimeline steps={deliverySteps(r.inv, r.ex)} flagged={false} showLabel />
                <Button size="sm" variant={s.enabled && s.key !== "ferdig" ? "default" : "outline"} disabled={!s.enabled}>{s.label}</Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center">
          <div className="flex-1"><p className="font-display text-title">{ws.supplier} · {ws.no}</p><p className="text-caption text-muted-foreground">8. okt 2026 · kr {ws.amount} · Sum stemmer · lest fra PDF · høy sikkerhet</p></div>
          <DeliveryTimeline steps={deliverySteps(ws.inv, ws.ex)} />
          <Button>{step(ws).label}</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-caption text-muted-foreground"><tr>{["SKU", "Beskrivelse / råvare", "Antall", "Enhet", "Pris", "Sum", "Forventet", "Avvik", "Status"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{LINES.map((l) => (
              <tr key={l.sku} className="border-t border-border">
                <td className="p-2">{l.sku}</td><td className="p-2"><p>{l.desc}</p><p className="text-caption text-muted-foreground">{l.rm}</p></td>
                <td className="p-2">{l.qty}</td><td className="p-2">{l.unit}</td><td className="p-2">{l.price}</td><td className="p-2">{l.sum}</td>
                <td className="p-2">{l.exp}</td><td className="p-2">{l.dev}</td><td className="p-2"><Badge variant="outline">{l.status}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TooltipProvider><App /></TooltipProvider>);
