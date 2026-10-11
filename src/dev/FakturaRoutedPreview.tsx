import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import FakturaWorkspace from "@/ravarer/pages/priskontroll/faktura/FakturaWorkspace";
import { FakturaerProvider } from "@/fakturaer/context/FakturaerContext";
import samplePdf from "./sample-credit-note.pdf?url";
import "@/index.css";

/**
 * Lokal sjekk av den EKTE fakturaarbeidsflaten med fast faktura i cache (kun dev-server).
 * `?f=credit|normal|eur|nullvat|mismatch`, `?tabell=1` = lagret tabellpreferanse.
 * Linjekøen krever innlogging og viser feil her; tabellvisningen bruker fakturadetaljen.
 */
const sp = new URLSearchParams(window.location.search);
const f = sp.get("f") ?? "mismatch";
if (sp.get("tabell") === "1") localStorage.setItem("ui-pref:ravarer.faktura.tabellvisning", "true");
else localStorage.removeItem("ui-pref:ravarer.faktura.tabellvisning");

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
const DOC = "dev/sample-credit-note.pdf";
const line = (n: number, desc: string, o: Record<string, unknown>) => ({
  id: `l${n}`, line_number: n, description: desc, supplier_sku: `S${n}`, unit: "sekk", match_confidence: "manual", extraction_issues: [], requires_review: true,
  raw_material_id: `rm${n}`, raw_materials: { id: `rm${n}`, name: desc, sku: null }, review_reason: "price_variance", line_kind: null, resolution_note: null, ledger_account: null, ...o,
});
const normalLines = [
  line(1, "Combisur Soft 20 kg", { quantity: 10, unit_price: 100, total_amount: 1000, base_quantity: 200, price_per_base_unit: 5, expected_price_per_base_unit: 4.5, price_variance_pct: 11.1 }),
  line(2, "Kardemomme hel 1 kg", { quantity: 2, unit_price: 250, total_amount: 500, base_quantity: 2, price_per_base_unit: 250, expected_price_per_base_unit: 250, price_variance_pct: 0, requires_review: false, review_reason: null }),
];
const base = {
  id: "p1", legal_entity_id: "le-1", supplier_id: "s1", invoice_date: "2026-10-02", due_date: "2026-10-30", status: "needs_review",
  source: "tripletex", source_document_url: DOC, vat_inferred: false, extraction_confidence: 1, extraction_issues: [], line_extraction_status: "done",
  line_extraction_attempts: 1, line_extraction_error: null, lines_source: "pdf_extracted", reconciled_mode: null, is_credit_note: false, flagged_at: null,
  tripletex_voucher_number: "1234", tripletex_is_paid: false, paid_at: null, currency: "NOK",
  suppliers: { name: "Idun Industri AS", org_number: "912345678", contact_email: null }, legal_entities: { legal_name: "Nøtterø Bakeri" },
};
const fixtures: Record<string, Record<string, unknown>> = {
  credit: { ...base, invoice_number: "8050625", is_credit_note: true, total_amount: -336106.25, total_vat: -67221.25, lines_sum_excl_vat: -268885, lines_sum_status: "ok", lines_sum_variance_pct: 0,
    invoice_lines: [line(1, "Combisur Soft 20 kg", { quantity: -10, unit_price: 26888.5, total_amount: -268885, base_quantity: 200, price_per_base_unit: 2246, expected_price_per_base_unit: 10, price_variance_pct: 22377.2 })] },
  normal: { ...base, invoice_number: "1001", total_amount: 1875, total_vat: 375, lines_sum_excl_vat: 1500, lines_sum_status: "ok", lines_sum_variance_pct: 0, invoice_lines: normalLines },
  eur: { ...base, invoice_number: "EU-77", currency: "EUR", total_amount: 1875, total_vat: 375, lines_sum_excl_vat: 1500, lines_sum_status: "ok", lines_sum_variance_pct: 0, invoice_lines: normalLines },
  nullvat: { ...base, invoice_number: "NV-5", total_amount: 1875, total_vat: null, lines_sum_excl_vat: 1500, lines_sum_status: "not_checked", lines_sum_variance_pct: null, invoice_lines: normalLines },
  mismatch: { ...base, invoice_number: "526301", source_document_url: null, suppliers: { name: "A/S PALS", org_number: "912345678", contact_email: null }, total_amount: 29652.45, total_vat: 3867.71,
    lines_sum_excl_vat: 343103.5, lines_sum_variance_pct: 1230.6, lines_sum_status: "mismatch", extraction_confidence: 0.99, invoice_lines: normalLines },
};
qc.setQueryData(["invoice", "p1"], fixtures[f] ?? fixtures.mismatch);
qc.setQueryData(["invoice-doc-url", DOC], samplePdf);
qc.setQueryData(["price-holds", "le-1", "s1"], new Map<string, boolean>([["sku:s1", sp.get("hold") === "1"]]));

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><AuthProvider><FakturaerProvider><TooltipProvider><MemoryRouter initialEntries={["/ravarer/priskontroll/faktura/p1?retur=fane%3Dgjore"]}>
    <div className="min-h-screen bg-background px-4 py-4 md:px-8"><Routes><Route path="/ravarer/priskontroll/faktura/:id" element={<FakturaWorkspace />} /></Routes></div>
  </MemoryRouter></TooltipProvider></FakturaerProvider></AuthProvider></QueryClientProvider>,
);
