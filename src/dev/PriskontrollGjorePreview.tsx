import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { InvoiceFactsView, type InvoiceFacts } from "@/fakturaer/components/invoice-detail/InvoiceFactsCard";
import type { SupplierItem } from "@/fakturaer/lib/supplierItems";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { WorkListView } from "@/ravarer/pages/priskontroll/gjore/WorkListView";
import { VarekortHeaderView, VBlock } from "@/ravarer/pages/priskontroll/gjore/VarekortHeaderView";
import { PriceBlockView, type PriceRow } from "@/ravarer/pages/priskontroll/gjore/PriceBlockView";
import "@/index.css";
import { WORK_ITEM_EFFECT_DEFAULTS } from "@/ravarer/lib/workRpcTypes";

const w = (key: string, kind: WorkItem["kind"], title: string, supplier: string, impact: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  key, grp: kind.startsWith("faktura") ? "fakturaer" : "pris", type: kind.startsWith("faktura") ? "faktura" : "varekort", kind,
  supplier_id: "s", supplier_name: supplier, item_key: null, invoice_id: null, invoice_number: null, title, sku: null,
  rm_id: null, rm_name: null, open_lines: 3, open_invoices: 3, invoice_count: 3, amount: 0, impact_nok: impact,
  last_date: "2026-10-08", last_open_line_id: null, reasons: [], ...WORK_ITEM_EFFECT_DEFAULTS, read_integrity_flags: [], ...extra,
});
const ITEMS: WorkItem[] = [
  w("v1", "prisavvik", "SOFTISMIKS UHT 5L DIPLOM-IS", "Diplom-Is AS", 1240, { sku: "40213" }),
  w("v2", "mangler_pakning", "Idun Combisur Soft, sekk 20 kg", "Idun Industri AS", 27463, { open_lines: 7, open_invoices: 7 }),
  w("f1", "faktura_sumavvik", "A/S PALS · faktura 526301", "A/S PALS", 0, { amount: 18452 }),
  w("v3", "ukoblet", "KARDEMOMME 1 HT VARMEBE.", "Engrospartner", 812, { sku: "1182" }),
  w("f2", "faktura_mangler_linjer", "Bama · faktura 99102", "Bama Storkjøkken", 0, { amount: 6420 }),
  w("v4", "kontroll", "Smør usaltet 10 kg", "Tine SA", 420, { sku: "220" }),
  w("f3", "faktura_klar", "Idun Industri AS · faktura 1515620", "Idun Industri AS", 0, { amount: 33120 }),
  w("v5", "prisavvik", "Californiske rosiner select", "Engrospartner", 13084, { sku: "8812" }),
];
const ITEM: SupplierItem = {
  supplier_id: "s", supplier_name: "Diplom-Is AS", item_key: "sku:40213", supplier_sku: "40213", description: "SOFTISMIKS UHT 5L DIPLOM-IS",
  line_count: 12, invoice_count: 12, first_seen: "2025-01-10", last_seen: "2026-10-08", open_lines: 3, last_line_id: null, last_open_line_id: null,
  last_invoice_id: null, last_invoice_date: "2026-10-08", linked_rm_id: "rm", rm_id: "rm", rm_name: "Softismiks", rm_sku: null, rm_base_unit: "l",
  rm_category: "Meieri", rm_cost: 70.13, rms_id: "rms", rms_notes: null, rms_supplier_sku: null, rms_sku_matches: true, package_size: 5, package_unit: "kanne", base_units_per_package: 5,
  package_confirmed_at: "2025-02-01", agreed_price_per_base_unit: 70.13, is_primary: true, variants: 1, last_ppbu: 78.4, prev_ppbu: 70.13,
  last_conf: "high", reasons_raw: "price_variance", status: "prisavvik",
};
const r = (id: string, inv: string, date: string, qty: number): PriceRow => ({
  id, invoice_id: inv, invoice_number: inv, invoice_date: date, quantity: qty / 5, unit: "kanne",
  price_per_base_unit: 78.4, expected_price_per_base_unit: 70.13, base_quantity: qty, effect_nok: Math.round(8.27 * qty * 100) / 100, reference_source: "agreement",
});
const ROWS = [r("a", "771201", "2026-09-24", 50), r("b", "771455", "2026-10-01", 50), r("c", "771702", "2026-10-08", 50)];
const FACTS: InvoiceFacts = {
  id: "i", legal_entity_id: "le", status: "pending_review", total_amount: 18452, total_vat: 3690.4, vat_inferred: false,
  tripletex_voucher_number: "2026-4411", tripletex_is_paid: false, paid_at: null, lines_sum_excl_vat: 14012, lines_sum_variance_pct: -5.1,
  lines_sum_status: "mismatch", extraction_confidence: 0.92, line_extraction_attempts: 1, lines_source: "pdf",
};

function Preview() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [valgt, setValgt] = useState("v1");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="min-h-screen bg-surface-canvas p-4 text-ink-primary">
      <div className="grid gap-4 xl:grid-cols-[minmax(380px,0.9fr)_minmax(460px,1.1fr)]">
        <WorkListView items={ITEMS} total={804} selectedKey={valgt} loading={false} fetchingMore={false} onSelect={(i) => setValgt(i.key)} onMore={() => undefined} />
        <div className="space-y-4">
          <div className="space-y-6 rounded-lg border border-border bg-card p-4">
            <VarekortHeaderView item={ITEM} openInvoices={3} />
            <VBlock n={1} title="Råvare" done summary={<span className="font-medium underline">Softismiks</span>} />
            <VBlock n={2} title="Pakning" done summary={<span className="text-ink-secondary">5 l per kanne</span>} />
            <VBlock n={3} title="Pris">
              <PriceBlockView rows={ROWS} blocked={[{ id: "k", invoice_id: "8050625", invoice_number: "8050625", invoice_date: "2026-10-02", label: "Kreditnota – ikke sammenlignbar varepris", detail: "" }]} status="ready" selected={sel} onToggle={toggle} baseUnit="l" referenceDate="2026-01-01"
                hasAgreement tolerancePct={3} hardCapPct={15} settings={null} reason="" onReason={() => undefined} canWrite busy={false}
                onAccept={() => undefined} onCase={() => undefined} onFixAgreement={() => undefined} onCheckPackage={() => undefined} />
            </VBlock>
          </div>
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <header className="space-y-1">
              <p className="text-caption text-ink-secondary">A/S PALS · 3. okt. 2026</p>
              <h2 className="font-display text-xl">Faktura 526301 · 18 452 kr</h2>
            </header>
            <InvoiceFactsView invoice={FACTS} />
            <div className="rounded-md border border-line-subtle p-3 text-sm">
              Linjene summerer til 14 012 kr, fakturaen sier 14 761,60 kr eks. mva — avvik 749,60 kr (−5,1 %).
              <div className="mt-2 flex flex-wrap gap-2"><Button size="sm">Kontroller mva-avvik</Button><Button size="sm" variant="outline">Les originalen på nytt</Button><Button size="sm" variant="ghost">Overstyr med begrunnelse</Button></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><TooltipProvider><Preview /></TooltipProvider></MemoryRouter>,
);
