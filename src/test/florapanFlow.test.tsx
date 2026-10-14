// @vitest-environment jsdom
// Florapan-flyten (syntetisk): feil varetype → pose 100 g → rabatt → bekreftet linje.
// Felles pakningslogikk, gjennomgangsplan, kildemerking og fersk kvittering etter lagring.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PackageInference, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { contentUnitsFor, describePackageSpec, initialContainer } from "@/fakturaer/lib/packageSpec";
import { buildReviewPlan, discountArithmeticText, packageActionLabel } from "@/fakturaer/lib/reviewPlan";
import { classifyDocumentOrigin } from "@/fakturaer/lib/documentOrigin";
import { cardFinished, freshStatusFrom } from "@/fakturaer/lib/freshReceipt";
import { parseSupplierItemLines } from "@/fakturaer/lib/parseRpcJson";
import { insightLineFromSupplierItem, lineClarifications } from "@/fakturaer/lib/lineInsight";

const base: SupplierItemLine = {
  id: "l1", invoice_id: "i1539842", invoice_number: "1539842", invoice_date: "2026-09-20", invoice_status: "needs_review", flagged_at: null, is_credit_note: false, reconciled_mode: null,
  line_number: 3, supplier_sku: "3021", description: "Florapan L62 k pose 100g", quantity: 10, unit: "pose", unit_price: 977.74, total_amount: 6697.5,
  package_size: null, package_unit: null, count_per_package: null, base_quantity: null, price_per_base_unit: null, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: "rm1", raw_material_name: "Florapan", match_confidence: "manual",
  requires_review: true, review_reason: "unknown_package_size", resolution_note: null, created_at: null, line_kind: null, cost_posted: false, in_price_history: false,
  price_context: true, discount_amount: 3079.9, unit_price_basis: "pakning", extraction_issues: [], line_updated_at: "2026-10-14T09:28:46.123456+00:00",
  rm_item_type: "ravare", rm_base_unit: "kg", invoice_source: "tripletex", invoice_lines_source: "pdf_extracted", invoice_approved: false,
};
const planItem = { rm_id: "rm1", rm_base_unit: "kg", package_confirmed_at: null, base_units_per_package: null };

describe("felles pakningsspesifikasjon", () => {
  it("100 g pose = 0,1 kg; pose er egen beholder, ikke sekk", () => {
    expect(initialContainer("pose")).toBe("pose");
    expect(initialContainer("poser")).toBe("pose");
    const s = describePackageSpec({ container: "pose", size: "100", contentUnit: "g" }, "kg", "pose");
    expect(s.state).toBe("valid");
    if (s.state === "valid") { expect(s.baseUnitsPerPackage).toBeCloseTo(0.1); expect(s.text).toMatch(/1 pose inneholder 100 g = 0,1 kg/); }
    expect(s.containerMismatch).toBe(false);
  });
  it("antall og vekt blandes aldri", () => {
    const s = describePackageSpec({ container: "pose", size: "100", contentUnit: "g" }, "stk", "pose");
    expect(s.state).toBe("invalid");
    expect(contentUnitsFor("stk")).toEqual(["stk"]);
    expect(contentUnitsFor("kg")).toEqual(["g", "kg"]);
  });
  it("beholder ulik fakturaens enhet vises som avvik", () => {
    expect(describePackageSpec({ container: "pose", size: "0,1", contentUnit: "kg" }, "kg", "sekk").containerMismatch).toBe(true);
  });
});

describe("gjennomgangsplan", () => {
  it("rekkefølge kilde→vare→pakning→prisgrunnlag→prisavvik→kontrollert; pakning først for Florapan", () => {
    const plan = buildReviewPlan(planItem, [base]);
    expect(plan.steps.map((s) => s.key)).toEqual(["kilde", "vare", "pakning", "prisgrunnlag", "prisavvik", "kontrollert"]);
    expect(plan.current?.key).toBe("pakning");
    expect(plan.primary).toMatchObject({ label: "Bekreft 100 g pose", invoiceId: "i1539842", lineId: "l1" });
    // Trykt rabatt forklarer summen: prisgrunnlag er ok.
    expect(plan.steps.find((s) => s.key === "prisgrunnlag")?.state).toBe("ok");
  });
  it("uten rabatt og uten grunnlag: «Registrer rabatt / avklar prisgrunnlag»", () => {
    const l = { ...base, discount_amount: null, unit_price_basis: null, review_reason: null };
    expect(buildReviewPlan(planItem, [l]).primary?.label).toBe("Registrer rabatt / avklar prisgrunnlag");
  });
  it("eldre svar uten prislesekontekst gir ukjent, aldri grønt", () => {
    const l = { ...base, price_context: false, review_reason: null };
    const plan = buildReviewPlan(planItem, [l]);
    expect(plan.steps.find((s) => s.key === "kilde")?.state).toBe("unknown");
    expect(plan.steps.find((s) => s.key === "prisgrunnlag")?.state).toBe("unknown");
  });
  it("første pris og prisavvik; 0 åpne = kontrollert, men fakturamangler vises separat", () => {
    expect(buildReviewPlan(planItem, [{ ...base, review_reason: null, variance_status: "no_baseline" }]).primary?.label).toBe("Bekreft første pris");
    expect(buildReviewPlan(planItem, [{ ...base, review_reason: "price_increase" }]).primary?.label).toBe("Vurder pris");
    const done = buildReviewPlan(planItem, [{ ...base, requires_review: false, review_reason: null }]);
    expect(done.openLines).toBe(0);
    expect(done.primary).toBeNull();
    expect(done.invoiceFollowUp).toEqual([{ invoiceId: "i1539842", invoiceNumber: "1539842" }]);
  });
  it("avkortet utvalg markeres ufullstendig", () => {
    expect(buildReviewPlan(planItem, Array.from({ length: 200 }, (_, i) => ({ ...base, id: `x${i}` }))).incomplete).toBe(true);
  });
  it("prisgrunnlag følger delt lesekontroll: rabatt som ikke forklarer summen er ikke ok", () => {
    const l = { ...base, discount_amount: 100, review_reason: null };
    expect(buildReviewPlan(planItem, [l]).steps.find((s) => s.key === "prisgrunnlag")?.state).toBe("todo");
  });
  it("stk-vare med 100 g innhold: neste handling er varetype/grunnenhet, ikke å bekrefte vekt som antall", () => {
    const stk = { ...planItem, rm_base_unit: "stk" };
    expect(buildReviewPlan(stk, [{ ...base, package_size: 100, package_unit: "g" }]).primary?.label).toBe("Rett varetype og måleenhet");
  });
  it("én neste handling per åpen faktura, eldste først, til eksakt linje", () => {
    const b = { ...base, id: "l2", invoice_id: "i2", invoice_number: "1600000", invoice_date: "2026-10-01", review_reason: "price_increase" };
    const plan = buildReviewPlan(planItem, [b, base]);
    expect(plan.perInvoice.map((a) => [a.invoiceNumber, a.lineId, a.label])).toEqual([["1539842", "l1", "Bekreft 100 g pose"], ["1600000", "l2", "Vurder pris"]]);
  });
  it("etikett og rabattregnestykke", () => {
    expect(packageActionLabel({ description: "Mel 25 kg", unit: "sekk" })).toBe("Bekreft 25 kg sekk");
    expect(discountArithmeticText(base)).toBe("10 pose × 977,74 − rabatt 3 079,90 = 6 697,50 (netto 669,75 per pose)");
  });
});

describe("prislesekontekst fra rm_supplier_item_lines v2", () => {
  it("parser feltene, og kjører delt regnestykke bare når de finnes", () => {
    const [v2] = parseSupplierItemLines([{ ...base }] as never);
    expect(v2.price_context).toBe(true);
    expect(v2.discount_amount).toBe(3079.9);
    const kgItem = { rm_name: "Florapan", rm_category: null, rm_base_unit: "kg", rm_id: "rm1", base_units_per_package: null, package_confirmed_at: null };
    expect(insightLineFromSupplierItem(kgItem, v2).arithmetic_context).toBe("complete");
    expect(lineClarifications(insightLineFromSupplierItem(kgItem, v2)).some((c) => c.id === "read_issue")).toBe(false);
    const { discount_amount: _d, unit_price_basis: _u, line_updated_at: _t, ...old } = base;
    const [v1] = parseSupplierItemLines([old] as never);
    expect(v1.price_context).toBe(false);
    expect(insightLineFromSupplierItem(kgItem, v1).arithmetic_context).toBe("incomplete");
  });
});

describe("kildemerking fra dokumentets innhold", () => {
  it("Tripletex i metadata = generert visning; ellers ukjent (aldri antatt original)", () => {
    expect(classifyDocumentOrigin({ producer: "Tripletex AS PDF" }).origin).toBe("tripletex_generert");
    expect(classifyDocumentOrigin({ text: "Faktura generert i Tripletex" }).origin).toBe("tripletex_generert");
    expect(classifyDocumentOrigin({ producer: "Microsoft Word", text: "Idun Industri AS" }).origin).toBe("ukjent");
  });
});

describe("fersk kvittering", () => {
  const it1 = (open: unknown, extra: Partial<SupplierItem> = {}) => ({ items: [{ supplier_id: "s1", item_key: "sku:3021", open_lines: open, ...extra } as unknown as SupplierItem] });
  const ok = { isError: false, data: [base] };
  const f = (item: { isError: boolean; data: { items: SupplierItem[] } | undefined }, lines = ok) => freshStatusFrom({ item, lines, supplierId: "s1", itemKey: "sku:3021" });
  it("varekortfeil/tomt/annet kort/ugyldig tall = ukjent, aldri 0", () => {
    expect(f({ isError: true, data: undefined }).kind).toBe("unknown");
    expect(f({ isError: false, data: { items: [] } }).kind).toBe("unknown");
    expect(f({ isError: false, data: it1(0, { item_key: "sku:9" }) }).kind).toBe("unknown");
    expect(f({ isError: false, data: it1(null) }).kind).toBe("unknown");
  });
  it("antallet kommer fra serverens open_lines, ikke linjeutvalget", () => {
    // 500 åpne, men ingen av de 200 første linjene er åpne: aldri ferdig.
    const st = f({ isError: false, data: it1(500) }, { isError: false, data: Array.from({ length: 200 }, (_, k) => ({ ...base, id: `x${k}`, requires_review: false })) });
    expect(st).toMatchObject({ kind: "ok", remaining: 500, complete: false });
    expect(cardFinished(st)).toBe(false);
    // Linjefeil eller ukjent requires_review gjør bare lenkene ufullstendige.
    expect(f({ isError: false, data: it1(1) }, { isError: true, data: undefined })).toMatchObject({ remaining: 1, complete: false });
    expect(f({ isError: false, data: it1(1) }, { isError: false, data: [{ ...base, requires_review: null as unknown as boolean }] })).toMatchObject({ complete: false });
    expect(cardFinished(f({ isError: false, data: it1(0) }, { isError: false, data: [] }))).toBe(true);
  });
});

// ---- Integrasjon: ekte VarekortPanel + SupplierItemLinkForm, mocket RPC/refetch ----
const item = {
  supplier_id: "s1", item_key: "sku:3021", supplier_name: "Leverandør", supplier_sku: "3021", description: "Florapan L62 k pose 100g",
  status: "mangler_pakning", rm_id: "rm1", linked_rm_id: "rm1", rm_name: "Florapan", rm_sku: null, rm_base_unit: "kg", rm_category: "Råvare", rm_cost: null,
  package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null, agreed_price_per_base_unit: null,
  last_open_line_id: "l1", last_line_id: "l1", is_primary: true, open_lines: 2,
} as unknown as SupplierItem;
const inference: PackageInference = {
  ok: true, base_unit: "kg", line_unit: "pose", arithmetic: null, description: { count: null, size: 100, unit: "g", total: 0.1, bupp: 0.1 },
  agrees: false, suggested_bupp: 0.1, source: "varenavn", auto_confirmable: false, direct: false, direct_factor: null, explanation: "Varenavnet antyder 100 g.",
};
let linesNow: SupplierItemLine[] = [];
const mutateAsync = vi.fn();
const onDone = vi.fn();
vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "c1" } }) }));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite: true }) }));
vi.mock("@/fakturaer/hooks/useSupplierItems", () => ({
  useSupplierItems: () => ({ data: { items: [item] }, isLoading: false, isError: false, error: null, refetch: async () => ({ data: { items: [{ ...item, open_lines: linesNow.filter((l) => l.requires_review).length }] }, isError: false }) }),
  useSupplierItemLines: () => ({ data: linesNow, isLoading: false, isError: false, error: null,
    refetch: async () => { await new Promise((r) => setTimeout(r, 5)); return { data: linesNow, isError: false }; } }),
  usePackageInference: (id: string | null, b: string | null) => ({ data: id && b ? inference : undefined, isFetching: false }),
  useLinkSupplierItem: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/fakturaer/hooks/useMaterialChoices", () => ({
  useMaterialChoices: () => ({ suggestions: { data: [] }, results: { data: [] } }),
  useMaterialById: () => ({ data: { id: "rm1", name: "Florapan", base_unit: "kg" }, isLoading: false, refetch: vi.fn() }),
}));
vi.mock("@/fakturaer/components/supplier-item/SupplierItemHistory", () => ({ SupplierItemHistory: () => null }));
vi.mock("@/fakturaer/components/decisions/AuditHistory", () => ({ AuditHistory: () => null }));
vi.mock("@/ravarer/pages/priskontroll/gjore/SupplierLinkAliases", () => ({ SupplierLinkAliases: () => null }));

const linkResult = { ok: true, mode: "koblet", raw_material_id: "rm1", raw_material_supplier_id: "rms1", created_raw_material: false, lines_updated: 1, invoices: [], failures: [], still_open_lines: 1 };

async function renderPanel() {
  const { VarekortPanel } = await import("@/ravarer/pages/priskontroll/gjore/VarekortPanel");
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VarekortPanel supplierId="s1" itemKey="sku:3021" onDone={onDone} onNext={() => {}} originalLineId="l1" onOriginalLine={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("varekort: pakning lagret → fersk serverstatus → kortet blir stående ved gjenstående linjer", () => {
  beforeEach(() => { mutateAsync.mockReset(); onDone.mockReset(); });

  it("viser plan, felles pakningsfelt og rabattregnestykket; lagring sender 0,1 kg per pose", async () => {
    linesNow = [base, { ...base, id: "l2", invoice_id: "i2", invoice_number: "1540001", invoice_date: "2026-09-25", review_reason: "price_increase" }];
    mutateAsync.mockImplementation(async () => { linesNow = [{ ...base, requires_review: false, review_reason: null }, linesNow[1]]; return linkResult; });
    await renderPanel();
    expect(screen.getByLabelText("Gjennomgangsplan")).toBeTruthy();
    expect(screen.getByTestId("rabatt-regnestykke").textContent).toMatch(/rabatt 3 079,90 = 6 697,50/);
    expect(screen.getByText(/Fakturert som:/)).toBeTruthy();
    const size = screen.getByLabelText(/Innhold per pose/) as HTMLInputElement;
    expect(size.value).toBe("0,1");
    fireEvent.click(screen.getByRole("button", { name: /Koble og regn om/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].package).toEqual({ package_size: 100, package_unit: "g", base_units_per_package: 0.1, confirm: expect.any(Boolean) });
    expect(await screen.findByText(/1 linje gjenstår på 1 faktura/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Faktura 1540001" }).getAttribute("href")).toBe("/ravarer/priskontroll/faktura/i2?linje=l2");
  });

  it("0 åpne etter fersk henting: kortet regnes ferdig og arbeidsflaten går videre", async () => {
    linesNow = [base];
    mutateAsync.mockImplementation(async () => { linesNow = [{ ...base, requires_review: false, review_reason: null }]; return { ...linkResult, still_open_lines: 0 }; });
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Koble og regn om/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/varekortet er behandlet/)).toBeTruthy();
  });
});
