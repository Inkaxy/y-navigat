// @vitest-environment happy-dom
/**
 * Regresjon 1539842/c46e033e (syntetisk kopi, ingen ekte data): pose, prisgrunnlag pakning, trykt rabatt
 * 3 079,90, 100 g, extraction_issues=[]. Inspektøren skal regne med rabatten som serveren, vise rabatten,
 * og aldri stå med en død hovedknapp.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const RM = { id: "rm-pose", name: "Florapan pose", sku: "R-3021", category: "Emballasje", current_cost_price: null, base_unit: "stk", primary_supplier_id: null, item_type: "emballasje" };

function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "limit", "order", "not", "range", "is"]) c[m] = () => c;
  c.single = () => Promise.resolve({ data: table === "raw_materials" ? RM : null, error: null });
  c.maybeSingle = c.single;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } },
}));
vi.mock("@/fakturaer/lib/acceptMatch", () => ({ acceptMatch: vi.fn(), recalculateLines: vi.fn(), startPriceOutcomeLabel: () => null }));

import { LineTask } from "@/fakturaer/components/inbox/task/LineTask";
import { lineStatus } from "@/fakturaer/lib/lineStatus";
import { PriceGateProvider } from "@/fakturaer/lib/priceGateContext";
import { reasonGate, refineGateForLine } from "@/fakturaer/lib/priceSafety";
import { lineArithmeticText } from "@/fakturaer/lib/lineArithmeticText";
import { lineClarifications, packageGateFromReview, insightLineFromSupplierItem } from "@/fakturaer/lib/lineInsight";
import { initialContainer } from "@/fakturaer/lib/packageSpec";

function poseLine(over: Partial<ReviewLineRow> = {}): ReviewLineRow {
  return {
    id: "c46e-synth", updated_at: "2026-10-14T10:00:30.123456+00:00", invoice_id: "inv-1539842", line_number: 3,
    supplier_sku: "3021", description: "Florapan pose 100g", quantity: 10, unit: "pose", unit_price: 977.74, total_amount: 6697.5,
    package_size: 100, package_unit: "g", count_per_package: null, unit_price_basis: "pakning", discount_amount: 3079.9, extraction_issues: [],
    line_kind: "vare", base_quantity: null, match_confidence: "manual", raw_material_id: RM.id, price_per_base_unit: 669.75,
    expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, review_reason: "unknown_package_size", requires_review: true,
    price_reference_source: null, price_reference_id: null, price_reference_date: null,
    invoice: { id: "inv-1539842", invoice_number: "1539842", invoice_date: "2026-09-20", legal_entity_id: "le", supplier_id: "sup", status: "needs_review",
      source: "tripletex", currency: "NOK", is_credit_note: false, source_document_url: "x/1539842.pdf", total_amount: null, total_vat: null,
      lines_sum_status: "ok", lines_sum_excl_vat: null, lines_sum_variance_pct: null, extraction_confidence: null,
      supplier: { name: "Idun", contact_email: null }, legal_entity: null },
    suggestions: [], matched_raw_material: { name: RM.name, sku: RM.sku, category: "Emballasje", item_type: "emballasje", base_unit: "stk" },
    ...over,
  };
}

function setup(line: ReviewLineRow, reason: string | null, onCorrectLine = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gateFor = () => reasonGate(reason);
  const node = (
    <QueryClientProvider client={qc}>
      <PriceGateProvider gateFor={gateFor}>
        <LineTask key={line.id} line={line} status={lineStatus(line)} link={null} tolerancePct={5} position={{ index: 0, total: 1 }}
          canWrite reconcileReady={false} onPrev={vi.fn()} onNext={vi.fn()} onSaved={vi.fn(async () => {})} onSecondary={vi.fn()}
          onShowDocument={vi.fn()} onReconcile={vi.fn()} onCorrectLine={onCorrectLine} />
      </PriceGateProvider>
    </QueryClientProvider>
  );
  return { ...render(node as ReactNode), onCorrectLine };
}

beforeEach(() => cleanup());

describe("rabattlinje – delt regnestykke", () => {
  it("rabatt og pakningsgrunnlag går opp: ingen lesefeil, rabatten vises", () => {
    const l = poseLine();
    const c = lineClarifications({ ...l, package_gate: packageGateFromReview(l.review_reason), server_review_reason: l.review_reason, extraction_issues: l.extraction_issues });
    expect(c.some((x) => x.id === "read_issue")).toBe(false);
    // pose er en beholder: stk-vare uten antall per pose er en reell pakningssperre, ikke en lesefeil.
    expect(c.find((x) => x.id === "unit_conflict")?.blocksPrice).toBe(true);
    expect(lineArithmeticText(l, "NOK")).toMatch(/10 pose × .*977,74.* − rabatt .*3\s?079,90.* = .*6\s?697,50/);
  });

  it("uten registrert rabatt er samme tall et regnestykke som må kontrolleres (ingen 1,5 %-skjuling)", () => {
    const l = poseLine({ discount_amount: null });
    const c = lineClarifications({ ...l, package_gate: "missing" });
    expect(c.some((x) => x.id === "read_issue")).toBe(true);
  });

  it("serverens lesevarsel vinner selv når regnestykket går opp", () => {
    const l = poseLine({ extraction_issues: [{ code: "x" }] });
    expect(lineClarifications({ ...l, extraction_issues: l.extraction_issues }).some((x) => x.id === "read_issue" && x.blocksPrice)).toBe(true);
  });

  it("varekortets adapter: linjens unknown_package_size vinner over gammel bekreftet faktor", () => {
    const item = { rm_name: RM.name, rm_category: "Emballasje", rm_base_unit: "stk", rm_id: RM.id, base_units_per_package: 1, package_confirmed_at: "2026-10-14" };
    const l = poseLine();
    const il = insightLineFromSupplierItem(item, { ...l, is_credit_note: false, price_context: true, line_kind: "vare" });
    expect(il.package_gate).toBe("missing");
    expect(lineClarifications(il).some((x) => x.id === "read_issue")).toBe(false);
  });

  it("fakturaens beholderetikett beholdes", () => {
    expect(initialContainer("kartong")).toBe("kartong");
    expect(initialContainer("pose")).toBe("pose");
  });
});

describe("prisstatus uten død knapp", () => {
  it("invalid_quantity uten grunnmengde peker til pakningen, ikke til lesing", () => {
    const g = refineGateForLine(reasonGate("invalid_quantity"), { quantity: 10, base_quantity: null }, false);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.action).toBe("complete_link_or_package");
    const kept = refineGateForLine(reasonGate("invalid_quantity"), { quantity: 10, base_quantity: null }, true);
    if (!kept.ok) expect(kept.action).toBe("review_reading");
    const other = refineGateForLine(reasonGate("line_arithmetic_unverified"), { quantity: 10, base_quantity: null }, false);
    if (!other.ok) expect(other.action).toBe("review_reading");
  });

  it("inspektøren viser rabatt og ingen «går ikke opp»", () => {
    setup(poseLine(), "line_needs_review");
    expect(screen.getByText(/− rabatt/)).toBeTruthy();
    expect(screen.queryByText(/går ikke opp/)).toBeNull();
    expect(screen.getByText(/Varetype: Emballasje/)).toBeTruthy();
  });

  it("lesestatus i prissteget gir aktiv «Rett fakturalinje» for nøyaktig linjen", () => {
    const l = poseLine({ review_reason: "price_increase", package_size: null, package_unit: null, unit: "kg", unit_price_basis: null, discount_amount: null, quantity: 10, unit_price: 10, total_amount: 100, matched_raw_material: { name: "Mel", sku: null, category: "Mel", item_type: "ravare", base_unit: "kg" } });
    const { onCorrectLine } = setup(l, "line_arithmetic_unverified");
    const btn = screen.getByRole("button", { name: "Rett fakturalinje" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onCorrectLine).toHaveBeenCalledWith(expect.objectContaining({ id: "c46e-synth" }));
  });

  it("ingen hovedknapp står deaktivert med «Kontroller linjebeløp og mengde»", () => {
    const l = poseLine({ review_reason: "price_increase", unit: "kg", package_size: null, package_unit: null, unit_price_basis: null, discount_amount: null, quantity: 10, unit_price: 10, total_amount: 100, matched_raw_material: { name: "Mel", sku: null, category: "Mel", item_type: "ravare", base_unit: "kg" } });
    setup(l, "invalid_quantity");
    const dead = screen.queryByRole("button", { name: "Kontroller linjebeløp og mengde" }) as HTMLButtonElement | null;
    expect(dead).toBeNull();
  });
});
