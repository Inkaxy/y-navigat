import { ModuleScope } from "@/providers/ModuleScope";
import { parseWorkItems, parseWorkSummary } from "@/ravarer/lib/workRpc";
import { ArbeidsbordView } from "@/ravarer/pages/priskontroll/arbeidsbord/ArbeidsbordView";
import { LineInsightPanel } from "@/fakturaer/components/inbox/task/LineInsightPanel";
import { lineClarifications, type InsightLine } from "@/fakturaer/lib/lineInsight";
import { Button } from "@/components/ui/button";
import { PriceBlockView } from "@/ravarer/pages/priskontroll/gjore/PriceBlockView";
import { splitByGate } from "@/ravarer/pages/priskontroll/gjore/PriceBlock";
import { reasonGate } from "@/fakturaer/lib/priceSafety";
import { clarifyHref } from "@/ravarer/pages/priskontroll/gjore/clarifyTarget";

// Syntetisk kopi: 7 linjer på 7 fakturaer, alle sperret (sum, sammenligningspris, gammel kreditnota).
const CB = [["1542054", "2026-09-01", "invoice_sum_not_verified"], ["1504396", "2026-07-15", "invoice_sum_not_verified"], ["1511398", "2026-08-01", "price_reference_unverified"],
  ["1508247", "2026-07-25", "price_reference_unverified"], ["1495829", "2026-06-20", "price_reference_unverified"], ["1491126", "2026-06-10", "price_reference_unverified"], ["8050625", "2026-05-02", "credit_note"]] as const;
const cbBlocked = splitByGate(CB.map(([nr, d]) => ({ id: `l-${nr}`, invoice_id: `demo-${nr}`, invoice_number: nr, invoice_date: d, quantity: 1, unit: "sekk" })),
  (l) => reasonGate(CB.find(([nr]) => l.id === `l-${nr}`)?.[2] ?? null)).blocked;

/**
 * SKRIVEBESKYTTET DEMONSTRASJON — syntetiske data, ingen nettverk og ingen skrivehandlinger.
 * Viser det faktiske arbeidsbordet (statusoversikt, liste, original + beslutning) med en
 * syntetisk beslutningsflate i stedet for serverpanelene.
 */
const items = [
  { key: "varekort:s1:sku:TEST-001", grp: "pakning", type: "varekort", kind: "mangler_pakning", supplier_id: "s1", supplier_name: "Demo Emballasje AS", item_key: "sku:TEST-001", title: "Testvare pose 100 g", sku: "TEST-001", open_lines: 1, open_invoices: 1, amount: 950, impact_nok: null, last_date: "2026-09-02" },
  { key: "varekort:s2:sku:11", grp: "pris", type: "varekort", kind: "prisavvik", supplier_id: "s2", supplier_name: "Demo Mølle AS", item_key: "sku:11", title: "Hvetemel siktet 6x1kg", sku: "11", open_lines: 2, open_invoices: 2, amount: 480, impact_nok: 24, effect_status: "verified_price_effect", read_integrity: "checked", last_date: "2026-09-05" },
  { key: "faktura:i3", grp: "fakturaer", type: "faktura", kind: "faktura_sumavvik", supplier_name: "Demo Meieri", invoice_id: "i3", invoice_number: "DEMO-3", title: "Demo Meieri · faktura DEMO-3", amount: 1200, impact_nok: null, last_date: "2026-09-08" },
  { key: "varekort:s4:sku:7", grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: "s4", supplier_name: "Demo Engros", item_key: "sku:7", title: "KARDEMOMME HEL 1 KG", sku: "7", open_lines: 3, open_invoices: 2, amount: 2100, impact_nok: null, last_date: "2026-09-10" },
];
items.splice(2, 0, { key: "varekort:s5:sku:TEST-002", grp: "pris", type: "varekort", kind: "prisavvik", action_required: "review_credit_note", supplier_id: "s5", supplier_name: "Testleverandør B", item_key: "sku:TEST-002", title: "Testmiks sekk 20 kg", sku: "TEST-002", open_lines: 7, open_invoices: 7, amount: 9800, impact_nok: null, last_date: "2026-05-02" } as (typeof items)[number]);
const work = parseWorkItems({ total: 5, counts: { alle: 5, kobling: 1, pakning: 1, pris: 2, kontroll: 0, fakturaer: 1, faktura_mangler_linjer: 0, faktura_sumavvik: 1, faktura_flagget: 0, faktura_klar: 0 }, items });
const summary = parseWorkSummary({ invoice_access: true, invoices: { reconciled_7d: 12 }, data_quality: {}, other: {} });

const lines: Record<string, InsightLine> = {
  "varekort:s1:sku:TEST-001": { description: "Testvare pose 100 g", quantity: 10, unit: "sekk", unit_price: 120, total_amount: 950, invoice: { is_credit_note: false }, matched_raw_material: { name: "Testvare pose 100 g", category: "Emballasje", item_type: "emballasje", base_unit: "stk" } },
  "varekort:s2:sku:11": { description: "Hvetemel siktet 6x1kg", quantity: 2, unit: "krt", unit_price: 20, total_amount: 240, invoice: { is_credit_note: false }, matched_raw_material: { name: "Hvetemel siktet", category: "Mel", item_type: "ravare", base_unit: "kg" } },
  "faktura:i3": { description: "Kreditnota smør", quantity: -2, unit: "stk", unit_price: 10, total_amount: -20, invoice: { is_credit_note: true } },
  "varekort:s4:sku:7": { description: "KARDEMOMME HEL 1 KG", quantity: 3, unit: "stk", unit_price: 700, total_amount: 2100, invoice: { is_credit_note: false }, suggestions: [
    { raw_material_id: "r1", confidence: 0.82, match_reason: "Leverandør-produktnavn", rank: 1, raw_material: { name: "Kardemomme hel" } },
    { raw_material_id: "r2", confidence: 0.61, match_reason: "Råvarenavn", rank: 2, raw_material: { name: "Kardemomme malt" } },
  ] },
};

export default function ArbeidsbordPreviewContent() {
  return (
    <ModuleScope appCode="ravarer">
      <main className="min-h-screen space-y-3 bg-background py-4">
        <p role="note" className="mx-page rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-semibold">Demonstrasjon – syntetiske data. Ingen henting eller lagring.</p>
        <ArbeidsbordView
          items={work.items} total={work.total} counts={work.counts} summary={summary}
          loading={false} isError={false} error={null} onRetry={() => undefined} fetchingMore={false} onMore={() => undefined}
          fullHref={() => "/forhandsvisning/arbeidsbord"} classicHref="/forhandsvisning/arbeidsbord"
          renderOriginal={(it) => (
            <div className="flex h-[60vh] flex-col rounded-xl border border-line-subtle bg-card xl:h-[calc(100vh-12rem)]">
              <div className="border-b border-line-subtle px-3 py-2 text-sm font-semibold">Original (demo) · {it.supplier_name}</div>
              <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-ink-secondary">Her vises originalfakturaen fra samme dokumentpanel som fakturasiden.</div>
            </div>
          )}
          renderDecision={(it, ctx) => {
            if (it.key === "varekort:s5:sku:TEST-002") return (
              <article className="space-y-3 rounded-xl border border-line-subtle bg-card p-4" aria-label="Beslutning (demo)">
                <p className="text-sm font-medium">Valgt faktura 1542054 · 01.09.2026</p>
                <PriceBlockView rows={[]} blocked={cbBlocked} status="ready" selected={new Set()} onToggle={() => undefined} hasAgreement={false} tolerancePct={3} hardCapPct={15} settings={null}
                  reason="" onReason={() => undefined} canWrite={false} busy={false} onAccept={() => undefined} onCase={() => undefined} onFixAgreement={() => undefined} onCheckPackage={() => undefined}
                  hrefFor={(b) => clarifyHref(b, "?fane=gjore")} selectedInvoiceId="demo-1542054" />
              </article>
            );
            const l = lines[it.key];
            const c = l ? lineClarifications(l) : [];
            return (
              <article className="space-y-3 rounded-xl border border-line-subtle bg-card p-4" aria-label="Beslutning (demo)">
                {l && <LineInsightPanel line={l} clarifications={c} />}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="min-h-[44px]" onClick={ctx.onSkip}>Hopp over</Button>
                  <Button className="min-h-[44px]" disabled>{c[0] ? (c[0].action === "original" ? "Kontroller originalen" : c[0].action === "pakning" ? "Bekreft pakningen" : "Kontroller varekoblingen") : "Vurder prisen"}</Button>
                </div>
              </article>
            );
          }}
        />
      </main>
    </ModuleScope>
  );
}
