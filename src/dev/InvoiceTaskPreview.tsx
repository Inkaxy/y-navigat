import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueueWorkspace } from "@/fakturaer/components/inbox/QueueWorkspace";
import { FocusHeader } from "@/fakturaer/components/inbox/FocusHeader";
import { lineStatus } from "@/fakturaer/lib/lineStatus";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import "@/index.css";

/**
 * Utviklingsforhåndsvisning av fakturakontrollen med FASTE data. Ingen
 * pålogging; lagreknappene skal ikke brukes her. Ikke en del av produksjonsbygget.
 */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const rms = [
  { id: "rm-kaffe", name: "Ali Original finmalt 90 g", sku: "R-1042", category: null, current_cost_price: 15, base_unit: "stk", primary_supplier_id: null, item_type: null },
  { id: "rm-mel", name: "Hvetemel, siktet", sku: "R-3", category: null, current_cost_price: 11.2, base_unit: "kg", primary_supplier_id: null, item_type: null },
  { id: "rm-havre", name: "Havredrikk, barista", sku: "R-2001", category: null, current_cost_price: 23, base_unit: "l", primary_supplier_id: null, item_type: null },
];
rms.forEach((r) => qc.setQueryData(["rm-detail", r.id], r));

const inv = {
  id: "inv-1", invoice_number: "DEMO-330702353", invoice_date: "2026-09-30", legal_entity_id: "le", supplier_id: "sup", status: "needs_review",
  source: "tripletex", currency: "NOK", is_credit_note: false, source_document_url: "x.pdf", total_amount: null, total_vat: null,
  lines_sum_status: null, lines_sum_excl_vat: null, lines_sum_variance_pct: null, extraction_confidence: null,
  supplier: { name: "ASKO ØST AS", contact_email: null }, legal_entity: null,
};
function l(o: Partial<ReviewLineRow> & { id: string }): ReviewLineRow {
  return {
    invoice_id: "inv-1", line_number: 1, supplier_sku: null, description: null, quantity: 1, unit: "stk", unit_price: 0, total_amount: 0,
    package_size: null, package_unit: null, count_per_package: null, base_quantity: null, match_confidence: "unmatched", raw_material_id: null,
    price_per_base_unit: null, expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, review_reason: null,
    requires_review: true, price_reference_source: null, price_reference_id: null, price_reference_date: null, invoice: inv, suggestions: [],
    matched_raw_material: null, ...o,
  };
}
const lines: ReviewLineRow[] = [
  l({ id: "a", line_number: 1, supplier_sku: "110482", description: "ALI ORIGINAL FINMALT 36X90G", quantity: 1, unit: "eske", unit_price: 541.03, total_amount: 8115.45,
      match_confidence: "auto_high", raw_material_id: "rm-kaffe", review_reason: "unknown_package_size",
      matched_raw_material: { name: "Ali Original finmalt 90 g", sku: "R-1042", category: null, base_unit: "stk" } }),
  l({ id: "b", line_number: 2, supplier_sku: "217753", description: "HAVREDRIKK BARISTA 1 L OATLY", quantity: 6, unit: "stk", unit_price: 23.82, total_amount: 142.92,
      review_reason: "unmatched", suggestions: [{ raw_material_id: "rm-havre", confidence: 0.92, match_reason: "Navnelikhet med registrert vare", rank: 1,
      raw_material: { name: "Havredrikk, barista", sku: "R-2001", category: null, current_cost_price: 23, base_unit: "l" } }] }),
  l({ id: "c", line_number: 3, description: "HVETEMEL SIKTET 25 KG", quantity: 2, unit: "sekk", unit_price: 310, total_amount: 620, match_confidence: "manual",
      raw_material_id: "rm-mel", review_reason: "price_increase", price_per_base_unit: 12.4, expected_price_per_base_unit: 11.2, price_variance_pct: 10.7,
      price_reference_source: "last_purchase", price_reference_date: "2026-09-12", base_quantity: 50,
      matched_raw_material: { name: "Hvetemel, siktet", sku: "R-3", category: null, base_unit: "kg" } }),
];
const links: SupplierLinkContext = { byRawMaterialId: new Map(), bySku: new Map(), byName: new Map(), forLine: () => null };

function Preview() {
  const [active, setActive] = useState("a");
  const idx = lines.findIndex((x) => x.id === active);
  const mobile = window.innerWidth < 768;
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <div className="min-h-screen space-y-5 bg-background px-4 py-6 text-foreground md:px-8">
          <FocusHeader invoice={null} fallback={inv} progress={{ handled: 1, total: 4, needs: 3 }} reconcileReady={false} undoLabel={null}
            onUndo={() => {}} onBack={() => {}} onReconcile={() => {}} onShowDocument={() => {}} />
          <QueueWorkspace lines={lines} statusOf={(x) => lineStatus(x)} showAll={false} onShowAll={() => {}} needsCount={3} reason="all" onReason={() => {}}
            sort="invoice_date" onSort={() => {}} multiSelect={false} onMultiSelect={() => {}} selected={{}} onToggleSelect={() => {}}
            bulk={{ count: 0, acceptable: 0, busy: false, onAccept: () => {}, onNotApplicable: () => {}, onCreate: () => {}, onClear: () => {} }}
            loading={false} error={null} onRetry={() => {}} emptyTitle="" activeLine={lines[idx]} onSelect={(x) => setActive(x.id)}
            onPrev={() => setActive(lines[Math.max(idx - 1, 0)].id)} onNext={() => setActive(lines[Math.min(idx + 1, lines.length - 1)].id)}
            links={links} toleranceFor={() => 5} showInvoice={false} canWrite reconcileReady={false} isMobile={mobile} countsError={false}
            onSaved={async () => {}} onSecondary={() => {}} onShowDocument={() => {}} onReconcile={() => {}} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
