// Nettverksfri forhåndsvisning av rader i Fra faktura › Nye varer. Syntetisk leverandør og ID-er; varenavn og tall
// speiler mønsteret fra en feillest linje (1 flaske lest, 6 solgt). Ingen skriving: «Opprett/Koble» svarer som når
// serveren ikke endret noen linjer, slik at feilmeldingen og «Prøv igjen» kan kontrolleres.
import { useState } from "react";
import type { Candidate } from "@/ravarer/lib/fraFaktura/newItems";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewItemRow } from "@/ravarer/pages/frafaktura/NewItemRow";
import type { useNewItemActions } from "@/ravarer/hooks/useNewItemActions";
import { NOTHING_LINKED, NothingSavedError } from "@/ravarer/lib/fraFaktura/linkOutcome";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

const LE = "00000000-0000-4000-8000-00000000le01";
const SUP = "00000000-0000-4000-8000-000000000s01";
const base: SupplierItemLine = {
  id: "", invoice_id: "", invoice_number: "DEMO1", invoice_date: "2025-10-01", invoice_status: "needs_review", flagged_at: null, is_credit_note: false, reconciled_mode: null,
  line_number: 1, supplier_sku: "9727", description: "ISTE CHAI THE KONSENTRAT 0,7L", quantity: 1, unit: "flaske", unit_price: 95.63, total_amount: 573.78,
  package_size: 0.7, package_unit: "l", count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: null, raw_material_name: null, match_confidence: "unmatched",
  requires_review: true, review_reason: "unmatched", resolution_note: null, created_at: null, line_kind: "vare", cost_posted: false, in_price_history: false,
  price_context: true, discount_amount: null, unit_price_basis: null, extraction_issues: [], line_updated_at: null, invoice_approved: false,
};
const rows: { item: WorkItem & { supplier_id: string; item_key: string }; lines: SupplierItemLine[] }[] = [
  { item: wi("sku:9727", "ISTE CHAI THE KONSENTRAT 0,7L", "9727"), lines: [{ ...base, id: "l1", invoice_id: "i1" }] },
  { item: wi("sku:4048468", "ISTE PEACH KONSENTRAT 0,7L MON", "404 8468"), lines: [{ ...base, id: "l2", invoice_id: "i2", description: "ISTE PEACH KONSENTRAT 0,7L MON", unit: "eske", count_per_package: 6, unit_price: 82.13, total_amount: 465.66, discount_amount: 27.1, supplier_sku: "404 8468",
    extraction_issues: [{ code: "regnestykke", message: "Mengde × pris (55.03) stemmer ikke med linjesummen (465.66)." }] }] },
  { item: wi("name:kanel", "KANEL", null), lines: [{ ...base, id: "l3", invoice_id: "i3", description: "KANEL", supplier_sku: null, unit: "kg", quantity: 5, unit_price: 120, total_amount: 600, package_size: null, package_unit: null, invoice_approved: true }] },
  { item: wi("name:havregryn", "HAVREGRYN SMÅ DAMPV. 15 KG STOR SEKK MED LANG TEKST", null), lines: [{ ...base, id: "l4", invoice_id: "i4", description: "HAVREGRYN SMÅ DAMPV. 15 KG STOR SEKK MED LANG TEKST", supplier_sku: null, unit: "sekk", quantity: 2, unit_price: 300, total_amount: 600, package_size: 15, package_unit: "kg" }] },
];
function wi(itemKey: string, title: string, sku: string | null): WorkItem & { supplier_id: string; item_key: string } {
  return { key: `varekort:${SUP}:${itemKey}`, grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: SUP, supplier_name: "Demo Grossist", item_key: itemKey, invoice_id: null, invoice_number: null,
    title, sku, rm_id: null, rm_name: null, open_lines: 1, open_invoices: 1, invoice_count: 1, amount: 0, impact_nok: null, last_date: "2025-10-01", last_open_line_id: null, reasons: [],
    effect_status: "unknown", effect_label: null, read_integrity: "unknown", read_integrity_flags: [], unknown_effect_lines: null, amount_kind: null, action_required: null };
}

const nothing = async (): Promise<never> => { await new Promise((r) => setTimeout(r, 300)); throw new NothingSavedError(NOTHING_LINKED); };
const actions: ReturnType<typeof useNewItemActions> = { link: nothing, notItem: nothing, costPost: nothing, undo: async () => "Angret (simulert).", canUndo: () => false, capFra: false };

/** Én eksisterende vare å koble til (for å vise «Feil varetype? Gjør til …»). */
const DEMO_CANDIDATES: Candidate[] = [{ id: "demo-rm-1", name: "Iste chai the konsentrat 0,7 l", sku: null, declaration_name: null, item_type: "ravare", base_unit: "l", cost: null }];
const DEMO_BY_ID = new Map(DEMO_CANDIDATES.map((c) => [c.id, c]));

export default function NyeVarerPreview() {
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
    c.setQueryData(["company"], { id: LE, legal_name: "Demo", display_name: "Demo", short_code: "D", org_number: "0", founded_year: null });
    for (const r of rows) c.setQueryData(["supplier-item-lines", LE, SUP, r.item.item_key], r.lines);
    c.setQueryData(["ravarer", "fra-faktura", "supplier-skus", SUP], new Map<string, string[]>());
    return c;
  });
  const [done, setDone] = useState<string | null>(null);
  return (
    <QueryClientProvider client={qc}>
      <main className="space-y-3 px-page py-4">
        <p className="text-caption text-ink-secondary">Syntetisk forhåndsvisning – ingen data lagres. Lagring svarer «ingen linjer endret».</p>
        {done && <p role="status">{done}</p>}
        <section aria-label="Nye varer" className="overflow-hidden rounded-2xl border border-line-subtle bg-card">
          <ul>
            {rows.map((r) => <NewItemRow key={r.item.key} row={r.item} candidates={DEMO_CANDIDATES} byId={DEMO_BY_ID} supplierRule={null} actions={actions} canWrite retur="/forhandsvisning/nye-varer"
              onDone={(k) => setDone(`Kvittering for ${k} (skal aldri vises her)`)} register={() => undefined} />)}
          </ul>
        </section>
      </main>
    </QueryClientProvider>
  );
}
