// Nettverksfri forhåndsvisning av fakturaflyten. HELT syntetiske navn, nummer, ID-er og beløp –
// ingen kundedata, PDF-tekst, URL-er eller konfigurasjon. Ingen skriving, ingen kall.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ReviewPlanCard } from "@/fakturaer/components/ReviewPlanCard";
import { PackageSpecFields } from "@/fakturaer/components/package/PackageSpecFields";
import { buildReviewPlan, discountArithmeticText } from "@/fakturaer/lib/reviewPlan";
import { describePackageSpec, type PackageSpecInput } from "@/fakturaer/lib/packageSpec";
import { ORIGIN_LABEL } from "@/fakturaer/lib/documentOrigin";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const nb = (n: number, d = 2) => n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });

const line: SupplierItemLine = {
  id: "00000000-0000-4000-8000-000000000101", invoice_id: "00000000-0000-4000-8000-000000001042", invoice_number: "DEMO1042", invoice_date: "2026-01-15", invoice_status: "needs_review", flagged_at: null, is_credit_note: false, reconciled_mode: null,
  line_number: 1, supplier_sku: "TEST-001", description: "Testvare pose 100g", quantity: 10, unit: "pose", unit_price: 120, total_amount: 950,
  package_size: null, package_unit: null, count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: "00000000-0000-4000-8000-000000000201", raw_material_name: "Testvare", match_confidence: "manual",
  requires_review: true, review_reason: "missing_base_unit", resolution_note: null, created_at: null, line_kind: null, cost_posted: false, in_price_history: false,
  price_context: true, discount_amount: null, unit_price_basis: null, extraction_issues: [], line_updated_at: "2026-01-15T08:00:00.000001+00:00",
  rm_item_type: "emballasje", rm_base_unit: "stk", invoice_source: "tripletex", invoice_lines_source: "pdf_extracted", invoice_approved: false,
};
const other: SupplierItemLine = { ...line, id: "00000000-0000-4000-8000-000000000102", invoice_id: "00000000-0000-4000-8000-000000001043", invoice_number: "DEMO1043", invoice_date: "2026-01-22", review_reason: "price_increase", discount_amount: 0, unit_price_basis: "pakning", unit_price: 100, total_amount: 1000 };
const kg = { rm_base_unit: "kg", rm_item_type: "ravare" } as const;
const done = { ...line, ...kg, requires_review: false, review_reason: null, discount_amount: 250, unit_price_basis: "pakning" } as SupplierItemLine;

const STEPS = [
  { title: "1. Feil varetype", note: "Testvaren står som Emballasje / stk. Rettes med «Rett varetype og måleenhet» til Råvare / kg.", lines: [line, other], base: "stk" },
  { title: "2. Varetype rettet", note: "Grunnenhet er nå kg. Gammel pakningsfaktor i stk er nullstilt, ikke tolket om.", lines: [{ ...line, ...kg, review_reason: "unknown_package_size" }, other], base: "kg" },
  { title: "3. Pose à 100 g", note: "Bekreft 100 g per pose: 100 g = 0,1 kg, så 10 poser = 1 kg.", lines: [{ ...line, ...kg, review_reason: "unknown_package_size" }, other], base: "kg" },
  { title: "4. Rabatt og tall", note: `Uten rabatt går ikke tallene opp: 10 × ${nb(120)} = ${nb(1200)} ≠ ${nb(950)}. Trykt rabatt ${nb(250)} registreres via «Rett fakturalinje».`, lines: [{ ...line, ...kg, review_reason: null }, other], base: "kg" },
  { title: "5. Linje ferdig", note: `Netto ${nb(95)} kr per pose, ${nb(950)} kr per kg. Linjen er kontrollert.`, lines: [done, other], base: "kg" },
  { title: "6. Andre linjer", note: "Faktura DEMO1043 står fortsatt åpen – neste handling peker til nøyaktig den linjen.", lines: [done, other], base: "kg" },
] as const;

export default function FakturaflytPreview() {
  const [i, setI] = useState(0);
  const [spec, setSpec] = useState<PackageSpecInput>({ container: "pose", size: "100", contentUnit: "g" });
  const st = STEPS[i];
  const plan = buildReviewPlan({ rm_id: line.raw_material_id ?? "", rm_base_unit: st.base, package_confirmed_at: i >= 3 ? "2026-01-15T08:05:00.000001+00:00" : null, base_units_per_package: i >= 3 ? 0.1 : null }, st.lines);
  const sel = st.lines[0];
  const pkg = describePackageSpec(spec, st.base, sel.unit);
  const arith = discountArithmeticText(sel);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-page py-6">
      <header className="space-y-1">
        <h1 className="text-title font-semibold">Fakturaflyt – forhåndsvisning</h1>
        <p className="text-caption text-ink-secondary">Helt syntetiske testdata (Testleverandør, DEMO1042). Ingen nettverk eller lagring · {ORIGIN_LABEL.tripletex_generert}.</p>
      </header>
      <nav aria-label="Steg" className="flex flex-wrap gap-1.5">
        {STEPS.map((s, k) => <Button key={s.title} size="sm" variant={k === i ? "secondary" : "outline"} className="min-h-[44px]" aria-pressed={k === i} onClick={() => setI(k)}>{s.title}</Button>)}
      </nav>
      <p className="text-sm">{st.note}</p>
      <ReviewPlanCard plan={plan} onAction={() => true} />
      {arith && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums">Trykt på fakturaen: {arith}</p>}
      {i === 2 && (
        <section aria-label="Pakning" className="space-y-2 rounded-md border border-line-subtle p-3">
          <PackageSpecFields idPrefix="demo" baseUnit={st.base} invoiceUnit={sel.unit} value={spec} onChange={setSpec} containerEditable />
          <p className="text-caption text-ink-secondary">{pkg.state === "valid" ? `Lagres som ${pkg.baseUnitsPerPackage.toLocaleString("nb-NO")} kg per ${spec.container}; 10 poser = ${(pkg.baseUnitsPerPackage * 10).toLocaleString("nb-NO")} kg (demo – ingenting lagres).` : "Ikke gyldig ennå."}</p>
        </section>
      )}
      {i >= 4 && (
        <p role="status" className="rounded-md border border-success/40 bg-success/5 p-3 text-sm">
          Kvittering: linje 1 på DEMO1042 kontrollert ({nb(95)} kr/pose). {i === 5 ? "1 linje gjenstår på DEMO1043 – varekortet blir stående." : "Andre åpne linjer vises i neste steg."}
        </p>
      )}
    </main>
  );
}
