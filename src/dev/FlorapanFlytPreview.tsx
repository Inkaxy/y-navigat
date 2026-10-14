// Nettverksfri forhåndsvisning av Florapan-flyten med syntetiske data. Ingen skriving, ingen kall.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ReviewPlanCard } from "@/fakturaer/components/ReviewPlanCard";
import { PackageSpecFields } from "@/fakturaer/components/package/PackageSpecFields";
import { buildReviewPlan, discountArithmeticText } from "@/fakturaer/lib/reviewPlan";
import { describePackageSpec, type PackageSpecInput } from "@/fakturaer/lib/packageSpec";
import { ORIGIN_LABEL } from "@/fakturaer/lib/documentOrigin";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const line: SupplierItemLine = {
  id: "demo-l1", invoice_id: "demo-1539842", invoice_number: "1539842", invoice_date: "2026-09-20", invoice_status: "needs_review", flagged_at: null, is_credit_note: false, reconciled_mode: null,
  line_number: 3, supplier_sku: "3021", description: "Florapan L62 k pose 100g", quantity: 10, unit: "pose", unit_price: 977.74, total_amount: 6697.5,
  package_size: null, package_unit: null, count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: "demo-rm", raw_material_name: "Florapan", match_confidence: "manual",
  requires_review: true, review_reason: "missing_base_unit", resolution_note: null, created_at: null, line_kind: null, cost_posted: false, in_price_history: false,
  price_context: true, discount_amount: null, unit_price_basis: null, extraction_issues: [], line_updated_at: "2026-10-14T09:28:46.123456+00:00",
  rm_item_type: "emballasje", rm_base_unit: "stk", invoice_source: "tripletex", invoice_lines_source: "pdf_extracted", invoice_approved: false,
};
const second: SupplierItemLine = { ...line, id: "demo-l2", invoice_id: "demo-1540001", invoice_number: "1540001", invoice_date: "2026-09-27", review_reason: "price_increase", discount_amount: 0, unit_price_basis: "pakning", total_amount: 9777.4 };

const STEPS = [
  { title: "1. Feil varetype", note: "Varen står som Emballasje / stk. Rettes med «Rett varetype og måleenhet» (Råvare / kg); oppskrifter i gram passer.", lines: [line, second], base: "stk" },
  { title: "2. Pose à 100 g", note: "Grunnenhet er nå kg. Pakningen i gammel enhet er nullstilt; bekreft 100 g per pose.", lines: [{ ...line, review_reason: "unknown_package_size", rm_base_unit: "kg", rm_item_type: "ravare" }, second], base: "kg" },
  { title: "3. Rabatt sperrer", note: "Pakningen er lagret. 10 × 977,74 ≠ 6 697,50 uten rabatt – registrer trykt rabatt via «Rett fakturalinje».", lines: [{ ...line, review_reason: null, rm_base_unit: "kg" }, second], base: "kg" },
  { title: "4. Linjen bekreftet", note: "Rabatt 3 079,90 er registrert med begrunnelse. Linje 1539842 er kontrollert; faktura 1540001 står fortsatt åpen.", lines: [{ ...line, requires_review: false, review_reason: null, discount_amount: 3079.9, unit_price_basis: "pakning", rm_base_unit: "kg" }, second], base: "kg" },
] as const;

export default function FlorapanFlytPreview() {
  const [i, setI] = useState(0);
  const [spec, setSpec] = useState<PackageSpecInput>({ container: "pose", size: "100", contentUnit: "g" });
  const st = STEPS[i];
  const plan = buildReviewPlan({ rm_id: "demo-rm", rm_base_unit: st.base, package_confirmed_at: null, base_units_per_package: null }, st.lines);
  const sel = st.lines[0];
  const pkg = describePackageSpec(spec, st.base, sel.unit);
  return (
      <main className="mx-auto max-w-3xl space-y-4 px-page py-6">
        <header className="space-y-1">
          <h1 className="text-title font-semibold">Florapan – forhåndsvisning av flyten</h1>
          <p className="text-caption text-ink-secondary">Syntetiske data, ingen nettverk eller lagring. Valgt faktura 1539842 · {ORIGIN_LABEL.tripletex_generert}.</p>
        </header>
        <nav aria-label="Steg" className="flex flex-wrap gap-1.5">
          {STEPS.map((s, k) => <Button key={s.title} size="sm" variant={k === i ? "secondary" : "outline"} className="min-h-[44px]" aria-pressed={k === i} onClick={() => setI(k)}>{s.title}</Button>)}
        </nav>
        <p className="text-sm">{st.note}</p>
        <ReviewPlanCard plan={plan} onAction={() => true} />
        {discountArithmeticText(sel) && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums">Trykt på fakturaen: {discountArithmeticText(sel)}</p>}
        {i === 1 && (
          <section aria-label="Pakning" className="space-y-2 rounded-md border border-line-subtle p-3">
            <PackageSpecFields idPrefix="demo" baseUnit={st.base} invoiceUnit={sel.unit} value={spec} onChange={setSpec} containerEditable />
            <p className="text-caption text-ink-secondary">{pkg.state === "valid" ? `Lagres som ${pkg.baseUnitsPerPackage.toLocaleString("nb-NO")} kg per ${spec.container} (demo – ingenting lagres).` : "Ikke gyldig ennå."}</p>
          </section>
        )}
        {i === 3 && (
          <p role="status" className="rounded-md border border-success/40 bg-success/5 p-3 text-sm">Delvis ferdig: 1 linje kontrollert. 1 linje gjenstår på faktura 1540001 – varekortet blir stående.</p>
        )}
      </main>
  );
}
