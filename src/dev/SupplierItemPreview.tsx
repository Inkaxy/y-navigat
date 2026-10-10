import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupplierItemsTable } from "@/fakturaer/components/supplier-item/SupplierItemsTable";
import { SupplierItemView } from "@/fakturaer/components/supplier-item/SupplierItemSheet";
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { PriceBasisNowView } from "@/ravarer/components/tabs/suppliers/PriceBasisNowCard";
import { InvoiceFactsView } from "@/fakturaer/components/invoice-detail/InvoiceFactsCard";
import { Button } from "@/components/ui/button";
import "@/index.css";

/** Utviklingsforhåndsvisning av Varekoblinger med FASTE data. Ikke en del av produksjonsbygget. */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });

const base: SupplierItem = {
  supplier_id: "s1", supplier_name: "Regal Mølle", item_key: "sku:10042", supplier_sku: "10042", description: "HVETEMEL SIKTET 25KG",
  line_count: 41, invoice_count: 22, first_seen: "2025-11-02", last_seen: "2026-10-06", open_lines: 8, last_line_id: "l1", last_open_line_id: "l1", last_invoice_id: "i1",
  last_invoice_date: "2026-10-06", linked_rm_id: "rm1", rm_id: "rm1", rm_name: "Hvetemel siktet", rm_sku: "R-3", rm_base_unit: "kg", rm_category: "Mel",
  rm_cost: 11.2, rms_id: "rms1", rms_notes: null, package_size: 25, package_unit: "sekk", base_units_per_package: null, package_confirmed_at: null,
  agreed_price_per_base_unit: null, is_primary: true, variants: 1, last_ppbu: 11.6, prev_ppbu: 11.2, last_conf: "auto_high",
  reasons_raw: "unknown_package_size", status: "mangler_pakning",
};
const items: SupplierItem[] = [
  base,
  { ...base, supplier_name: "ASKO ØST AS", item_key: "sku:110482", supplier_sku: "110482", description: "ALI ORIGINAL FINMALT 36X90G", rm_id: null, linked_rm_id: null, rm_name: null, rm_base_unit: null, open_lines: 3, line_count: 3, status: "ukoblet", reasons_raw: "unmatched", last_ppbu: null },
  { ...base, supplier_name: "Tine", item_key: "name:havredrikk barista", supplier_sku: null, description: "Havredrikk barista 1L", rm_name: "Havredrikk, barista", rm_base_unit: "l", base_units_per_package: 1, package_unit: "stk", package_confirmed_at: "2026-08-12", open_lines: 2, last_ppbu: 24.9, prev_ppbu: 23, status: "prisavvik", reasons_raw: "price_increase,price_variance,agreement_conflict" },
  { ...base, supplier_name: "Bring", item_key: "name:frakt", supplier_sku: null, description: "Frakt", rm_id: null, rm_name: null, open_lines: 0, line_count: 14, status: "ikke_vare", last_ppbu: null },
  { ...base, item_key: "sku:2", supplier_sku: "2", description: "RUGMEL FIN 25KG", rm_name: "Rugmel fint", base_units_per_package: 25, package_confirmed_at: "2026-05-01", open_lines: 0, status: "koblet", last_ppbu: 9.8, prev_ppbu: 9.9 },
];
const lines: SupplierItemLine[] = [1, 2, 3].map((n) => ({
  id: `l${n}`, invoice_id: `i${n}`, invoice_number: `33070${n}`, invoice_date: `2026-10-0${n}`, invoice_status: n === 3 ? "reconciled" : "needs_review",
  flagged_at: null, is_credit_note: false, reconciled_mode: n === 3 ? "auto" : null, line_number: n, supplier_sku: "10042", description: "HVETEMEL SIKTET 25KG",
  quantity: 4, unit: "sekk", unit_price: 290, total_amount: 1160, package_size: 25, package_unit: "sekk", count_per_package: null, base_quantity: n === 3 ? 100 : null,
  price_per_base_unit: n === 3 ? 11.6 : null, expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, price_reference_source: null,
  raw_material_id: "rm1", raw_material_name: "Hvetemel siktet", match_confidence: "auto_high", requires_review: n !== 3,
  review_reason: n !== 3 ? "unknown_package_size" : null, resolution_note: n === 3 ? "Første dokumenterte pris (11,60 kr/kg)" : null, created_at: null,
  line_kind: "vare", cost_posted: n === 3, in_price_history: n === 3,
}));
qc.setQueryData(["supplier-item-rm", "rm1"], { id: "rm1", name: "Hvetemel siktet", base_unit: "kg", sku: "R-3", category: "Mel", why: null });
qc.setQueryData(["package-inference", "l1", "kg"], {
  ok: true, direct: false, direct_factor: null, base_unit: "kg", line_unit: "sekk", arithmetic: { bupp: 25, raw: 25, ok: true }, description: { count: 1, size: 25, unit: "kg", total: 25, bupp: 25 },
  agrees: true, suggested_bupp: 25, source: "regnestykke_og_varenavn", auto_confirmable: true,
  explanation: "1 160 kr ÷ (4 sekk × 290 kr) gir 1 sekk, og varenavnet sier 25 kg — altså 25 kg per sekk.",
});

function App() {
  const [open, setOpen] = useState<SupplierItem>(base);
  return (
    <div className="space-y-6 px-page py-6">
      <h1 className="font-display text-3xl font-semibold">Varekoblinger</h1>
      <PriceBasisNowView baseUnit="kg" tolerancePct={3} tolIsCategory={false} rows={[
        { link: { id: "a", supplier_id: "s1", is_primary: true, notes: null }, name: "Regal Mølle", loading: false, error: false, ref: { source: "agreement", price: 11.2, reference_date: "2026-01-01", valid_to: null, reason: null } },
        { link: { id: "b", supplier_id: "s2", is_primary: false, notes: "Avtalepris 1,12 kr/kg satt i karantene 4. okt. 2026 — usannsynlig pris." }, name: "ASKO ØST AS", loading: false, error: false, ref: { source: "last_purchase", price: 11.85, reference_date: "2026-10-03", valid_to: null, reason: null } },
        { link: { id: "c", supplier_id: "s3", is_primary: false, notes: null }, name: "Tine", loading: false, error: false, ref: { source: "none", price: null, reference_date: null, valid_to: null, reason: null } },
      ]} />
      <InvoiceFactsView
        invoice={{ id: "i1", legal_entity_id: "le", status: "needs_review", total_amount: 14500, total_vat: 2900, vat_inferred: true, tripletex_voucher_number: "2026-4412", tripletex_is_paid: true, paid_at: "2026-10-08", lines_sum_excl_vat: 11600, lines_sum_variance_pct: 0.4, lines_sum_status: "ok", extraction_confidence: 0.91, line_extraction_attempts: 1, lines_source: "pdf_extracted" }}
        actions={<><Button size="sm" variant="outline">Hent linjer på nytt</Button><Button size="sm" variant="outline">Beregn på nytt</Button></>}
      />
      <SupplierItemsTable items={items} onOpen={setOpen} />
      <div className="max-w-[720px] rounded-lg border border-line-subtle bg-card p-5">
        <SupplierItemView item={open} linesQuery={{ data: lines, isLoading: false, isError: false, error: null, refetch: () => undefined }} onClose={() => undefined} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><TooltipProvider><MemoryRouter><App /></MemoryRouter></TooltipProvider></QueryClientProvider>,
);
