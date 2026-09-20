import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PriceComparisonView } from "@/ravarer/components/PriceComparisonView";
import { QueueTable } from "@/fakturaer/components/inbox/QueueTable";
import { BulkLinkPanel, type BulkLinkCandidate } from "@/fakturaer/components/BulkLinkPanel";
import type { PriceObservation, PriceSummary } from "@/ravarer/hooks/usePriceComparison";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkContext, SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import "@/index.css";

/**
 * Utviklingsforhåndsvisning av fakturakøen og prissammenligningen med FASTE
 * data. Ingen pålogging, ingen databasekall, ingen mutasjoner — bare den ekte
 * presentasjonen, slik at 390 px og 1280 px kan kontrolleres visuelt.
 *
 * Denne filen er ikke en del av produksjonsbygget (kun `index.html` bygges).
 */

/** Kildeverdien for en manuelt registrert pris. */
const MANUAL_PRICE_SOURCE = "manual";

const supplierNames = new Map<string, string>([
  ["sup-1", "Norgesmøllene"],
  ["sup-2", "Idun Industri"],
]);

const summary: PriceSummary = {
  agreement: { supplier_id: "sup-1", price: 14.5, valid_from: "2026-01-01", valid_to: null, priority: 1 },
  last_purchase: { price: 15.2, date: "2026-09-08", supplier_id: "sup-1", invoice_id: "inv-1", invoice_line_id: "l-1" },
  weighted_90d: 15.05,
  weighted_90d_amount: 30100,
  weighted_90d_quantity: 2000,
  weighted_90d_observations: 6,
  weighted_90d_suppliers: 2,
  unit_changed_at: "2026-03-01",
  on_date: "2026-09-20",
};

function obs(o: Partial<PriceObservation> & { id: string }): PriceObservation {
  return {
    price: 15.2,
    effective_date: "2026-09-08",
    source: "invoice",
    supplier_id: "sup-1",
    invoice_id: "inv-1",
    invoice_line_id: "l-1",
    currency: "NOK",
    is_credit: false,
    is_legacy: false,
    superseded_at: null,
    superseded_reason: null,
    base_quantity: 500,
    line_unit: "kg",
    confirmed_link: true,
    unit_changed_since: false,
    ...o,
  };
}

const observations: PriceObservation[] = [
  obs({ id: "o1" }),
  obs({ id: "o2", price: 12.4, currency: "EUR", effective_date: "2026-08-20", supplier_id: "sup-2", confirmed_link: false }),
  obs({ id: "o3", price: 0.0152, effective_date: "2026-01-14", unit_changed_since: true, base_quantity: null, is_legacy: true }),
  obs({ id: "o4", price: -15.2, effective_date: "2026-07-02", is_credit: true }),
  obs({ id: "o5", price: 16.9, effective_date: "2026-05-11", source: MANUAL_PRICE_SOURCE, invoice_id: null, superseded_at: "2026-06-01" }),
];

const link: SupplierLinkRow = {
  id: "rms-1",
  raw_material_id: "rm-1",
  supplier_sku: "MEL-25",
  supplier_product_name: "Hvetemel 25 kg",
  package_size: 25,
  package_unit: "kg",
  base_units_per_package: 25,
  package_confirmed_at: "2026-02-01",
  agreed_price_per_base_unit: 14.5,
  last_invoice_price: 15.2,
  last_invoice_date: "2026-09-08",
  raw_material: { name: "Hvetemel", sku: "RM-100", base_unit: "kg", category: "Mel" },
};

const links: SupplierLinkContext = {
  byRawMaterialId: new Map([["rm-1", link]]),
  bySku: new Map([["MEL-25", link]]),
  byName: new Map(),
  forLine: (l) => (l.raw_material_id === "rm-1" || l.supplier_sku === "MEL-25" ? link : null),
};

function line(l: Partial<ReviewLineRow> & { id: string }): ReviewLineRow {
  return {
    invoice_id: "inv-1",
    line_number: 1,
    supplier_sku: "MEL-25",
    description: "Hvetemel 25 kg",
    quantity: 20,
    unit: "sekk",
    unit_price: 380,
    total_amount: 7600,
    package_size: 25,
    package_unit: "kg",
    count_per_package: null,
    base_quantity: 500,
    match_confidence: "high",
    raw_material_id: "rm-1",
    price_per_base_unit: 15.2,
    expected_price_per_base_unit: 14.5,
    price_variance_pct: 4.83,
    variance_status: "over",
    review_reason: "price_variance",
    requires_review: true,
    price_reference_source: "agreement",
    price_reference_id: "agr-1",
    price_reference_date: "2026-01-01",
    invoice: {
      id: "inv-1",
      invoice_number: "F-10231",
      invoice_date: "2026-09-08",
      legal_entity_id: "le-1",
      supplier_id: "sup-1",
      status: "review",
      source: "ehf",
      currency: "NOK",
      is_credit_note: false,
      source_document_url: null,
      total_amount: 9500,
      total_vat: 1900,
      lines_sum_status: "ok",
      lines_sum_excl_vat: 7600,
      lines_sum_variance_pct: 0,
      extraction_confidence: 0.95,
      supplier: { name: "Norgesmøllene", contact_email: null },
      legal_entity: { legal_name: "Nøtterø Bakeri", short_code: "NB" },
    },
    suggestions: [],
    matched_raw_material: { name: "Hvetemel", sku: "RM-100", category: "Mel", item_type: "raw_material" },
    ...l,
  } as ReviewLineRow;
}

const lines: ReviewLineRow[] = [
  line({ id: "l-1" }),
  line({
    id: "l-2",
    description: "Sukker 10x1kg",
    supplier_sku: "SUK-10",
    raw_material_id: null,
    matched_raw_material: null,
    price_per_base_unit: null,
    expected_price_per_base_unit: null,
    price_variance_pct: null,
    variance_status: null,
    review_reason: "unmatched,unknown_package_size",
    price_reference_source: null,
    price_reference_id: null,
    price_reference_date: null,
    suggestions: [
      {
        raw_material_id: "rm-2",
        confidence: 0.82,
        match_reason: "navn",
        rank: 1,
        raw_material: { name: "Sukker", sku: "RM-200", category: "Søtning", current_cost_price: 18, base_unit: "kg" },
      },
    ],
  }),
  line({
    id: "l-3",
    description: "Smør 5 kg",
    supplier_sku: "SMR-5",
    total_amount: 0,
    price_per_base_unit: null,
    review_reason: "uncertain_cost,no_baseline",
    price_reference_source: "error",
  }),
];

const candidates: BulkLinkCandidate[] = [
  {
    line_id: "c1",
    invoice_id: "inv-2",
    invoice_number: "F-10244",
    invoice_date: "2026-09-12",
    description: "Hvetemel 25 kg",
    supplier_sku: "MEL-25",
    quantity: 12,
    unit: "sekk",
    total_amount: 4560,
    package_size: 25,
    package_unit: "kg",
    count_per_package: null,
    raw_material_id: null,
    match_confidence: "medium",
    eligible: true,
    exclusion_reason: null,
  },
  {
    line_id: "c2",
    invoice_id: "inv-3",
    invoice_number: "F-10199",
    invoice_date: "2026-08-30",
    description: "Hvetemel 6x2kg",
    supplier_sku: "MEL-25",
    quantity: 4,
    unit: "kartong",
    total_amount: 980,
    package_size: 2,
    package_unit: "kg",
    count_per_package: 6,
    raw_material_id: null,
    match_confidence: "low",
    eligible: false,
    exclusion_reason: "annen_pakning_beskrivelse",
  },
];

function noop() {}

function Preview() {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({ c1: true });

  return (
    <BrowserRouter>
      <TooltipProvider>
        <div className="min-h-screen space-y-8 bg-background px-4 py-6 text-foreground">
          <p className="text-caption text-ink-secondary">
            Utviklingsforhåndsvisning med faste data. Ingen pålogging og ingen databasekall.
          </p>

          <PriceComparisonView
            baseUnit="kg"
            onDate="2026-09-20"
            summary={summary}
            observations={observations}
            supplierNames={supplierNames}
            supplierId={supplierId}
            onSupplierChange={setSupplierId}
            suppliersError={new Error("Leverandørlisten feilet")}
            onRetrySuppliers={noop}
            isLoading={false}
            isError={false}
            error={null}
            onRetry={noop}
            loadedLimit={200}
            hasMore
            onLoadMore={noop}
          />

          <div className="overflow-x-auto">
            <QueueTable
              lines={lines}
              links={links}
              toleranceFor={() => 3}
              activeLineId="l-1"
              selected={{ "l-1": true }}
              onToggleSelect={noop}
              onToggleSelectAll={noop}
              onFocusLine={noop}
              onShowDocument={noop}
              onAction={noop}
              onAccept={noop}
              showInvoiceColumn
              canWrite
              repeatCounts={new Map([["sup-1|mel-25", 4]])}
            />
          </div>

          <Dialog open>
            <DialogContent className="max-w-3xl">
              <BulkLinkPanel
                rawMaterialName="Hvetemel"
                rows={candidates}
                selected={selected}
                onToggle={(id, v) => setSelected((p) => ({ ...p, [id]: v }))}
                busy={false}
                chosenCount={Object.values(selected).filter(Boolean).length}
                onApply={noop}
                onClose={noop}
                applyPending={false}
                pendingInvoices={[]}
                appliedCount={0}
                onRetry={noop}
                retryPending={false}
                isLoading={false}
                isError={false}
                error={null}
                onRetryLoad={noop}
              />
            </DialogContent>
          </Dialog>
        </div>
      </TooltipProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
