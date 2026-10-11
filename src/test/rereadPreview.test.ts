import { describe, expect, it, vi } from "vitest";
import { buildExtractorRequest, buildProposal, documentPathAllowed, mapLine } from "../../supabase/functions/reread-invoice-preview/proposal";
import { runPreview, type Deps, type RunRow } from "../../supabase/functions/reread-invoice-preview/flow";

const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
const OTHER = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RUN = "99999999-8888-4777-8666-555555555555";
const pdf = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(200));

const invoice = { supplier_id: OTHER, invoice_number: "8050625", is_credit_note: true, total_amount: -1250, total_vat: -250, legal_entity_id: LE, currency: "NOK", invoice_date: "2026-10-01" };
const run = (o: Partial<RunRow> = {}): RunRow => ({
  id: RUN, legal_entity_id: LE, invoice_id: "inv", created_by: USER, status: "reading", expires_at: new Date(Date.now() + 3600e3).toISOString(),
  document_path: `${LE}/2026/faktura.pdf`, snapshot: { invoice, lines: [{ supplier_sku: "A1", description: "Mel" }] }, ...o,
});
const resp = {
  extraction_method: "ai", confidence: 0.4, warnings: ["Sumavvik 3 %", "2 linje(r) har regneavvik"], attempts: 2,
  ai_usage: { in: 10, out: 5, cost: 0.01 }, matched_supplier: { id: OTHER }, name_matched_supplier: null,
  sum_check: { lines_sum: -1000, issues: [{ code: "sum_avvik", message: "Linjesum avviker" }] },
  extracted: { invoice_number: "8050625", total_amount: -1250, lines: [
    { sku: "A1", description: "Mel", quantity: -2, unit: "kg", unit_price: 250, unit_price_basis: "per_base", price_basis: "kg", total_amount: -500, discount_amount: null, discount_pct: null, ean: "7038", vat_rate: 15, package_size: 25, package_unit: "kg", count_per_package: null, line_kind: "vare", confidence: null, read_issues: [{ code: "tvetydig_tall", message: "Tvetydig" }], number_evidence: [{ field: "quantity", raw: "-2" }] },
  ] },
};

function deps(o: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readRunAsUser: async () => { calls.push("read"); return run(); },
    hasWriteAccess: async () => { calls.push("acl"); return true; },
    supplierName: async () => "Idun",
    download: async () => { calls.push("download"); return pdf; },
    extract: async () => { calls.push("extract"); return { ok: true, status: 200, json: resp }; },
    register: async () => { calls.push("register"); return { ok: true, replayed: false }; },
    fail: async (_id, code) => { calls.push(`fail:${code}`); },
    now: () => Date.now(),
    ...o,
  } as Deps & { calls: string[] };
}

describe("lesing på nytt – mapping", () => {
  it("sku→supplier_sku, price_basis (ikke modellens) → unit_price_basis, signerte kredittall", () => {
    const c = mapLine(resp.extracted.lines[0], 0);
    expect(c.candidate_id).toBe("line-0");
    expect(c.values.supplier_sku).toBe("A1");
    expect(c.values.unit_price_basis).toBe("kg");
    expect(c.values.quantity).toBe(-2);
    expect(c.values.total_amount).toBe(-500);
    expect(c.evidence.model_price_basis).toBe("per_base");
    expect(c.evidence.confidence).toBeNull();
    expect(c.evidence.ean).toBe("7038");
    expect(c.issues[0].code).toBe("tvetydig_tall");
  });
  it("ukjent prisgrunnlag og ugyldig pakning blir null med synlig varsel", () => {
    const c = mapLine({ description: "X", price_basis: "per_unit", package_size: 0 }, 3);
    expect(c.values.unit_price_basis).toBeNull();
    expect(c.values.package_size).toBeNull();
    expect(c.issues.filter((i) => i.code === "reread_value_dropped")).toHaveLength(2);
  });
  it("kontrolltall fra snapshot, ukjent mva blir aldri 0", () => {
    const r = buildExtractorRequest({ legalEntityId: LE, invoice: { ...invoice, total_vat: null }, lines: [], supplierName: null, pdfBase64: "x" });
    expect(r.expected_vat).toBeNull();
    expect(r.expected_total_excl_vat).toBeNull();
    expect(r.is_credit).toBe(true);
    const k = buildExtractorRequest({ legalEntityId: LE, invoice, lines: [], supplierName: null, pdfBase64: "x" });
    expect(k.expected_total_excl_vat).toBe(-1000);
    expect(k.expected_total_incl_vat).toBe(-1250);
  });
  it("alle varsler bevares i forslaget", () => {
    const b = buildProposal(resp, { invoice });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const ii = b.proposal.invoice_issues as { code: string; message: string }[];
    expect(ii.map((i) => i.message)).toEqual(["Linjesum avviker", "Sumavvik 3 %", "2 linje(r) har regneavvik"]);
    expect((b.extractor as { warning_count: number }).warning_count).toBe(2);
  });
  it("ugyldig svar og null linjer gir feil, aldri tomt forslag", () => {
    expect(buildProposal(null, { invoice })).toEqual({ ok: false, code: "leser_ugyldig_svar" });
    expect(buildProposal({ extracted: { lines: "x" } }, { invoice })).toEqual({ ok: false, code: "leser_ugyldig_svar" });
    expect(buildProposal({ extracted: { lines: [] } }, { invoice })).toEqual({ ok: false, code: "leser_ingen_linjer" });
  });
  it("dokumentsti må ligge i selskapets navnerom", () => {
    expect(documentPathAllowed(`${LE}/a.pdf`, LE)).toBe(true);
    expect(documentPathAllowed(`${OTHER}/a.pdf`, LE)).toBe(false);
    expect(documentPathAllowed(`${LE}/../${OTHER}/a.pdf`, LE)).toBe(false);
    expect(documentPathAllowed(`https://x/${LE}/a.pdf`, LE)).toBe(false);
    expect(documentPathAllowed(`/${LE}/a.pdf`, LE)).toBe(false);
  });
});

describe("lesing på nytt – flyt", () => {
  it("annen eier stoppes før nedlasting og leser", async () => {
    const d = deps({ readRunAsUser: async () => run({ created_by: OTHER }) });
    const r = await runPreview(d, USER, RUN);
    expect(r.body.code).toBe("annen_eier");
    expect(d.calls).not.toContain("download");
    expect(d.calls).not.toContain("extract");
  });
  it("mangler skrivetilgang stoppes før nedlasting", async () => {
    const d = deps({ hasWriteAccess: async () => false });
    expect((await runPreview(d, USER, RUN)).body.code).toBe("forbidden");
    expect(d.calls).not.toContain("download");
  });
  it("fremmed selskapssti avvises før nedlasting", async () => {
    const d = deps({ readRunAsUser: async () => run({ document_path: `${OTHER}/x.pdf` }) });
    const r = await runPreview(d, USER, RUN);
    expect(r.body.code).toBe("dokumentsti_avvist");
    expect(d.calls).not.toContain("download");
    expect(d.calls).not.toContain("extract");
  });
  it("avbrutt kjøring leses ikke", async () => {
    const d = deps({ readRunAsUser: async () => run({ status: "cancelled" }) });
    expect((await runPreview(d, USER, RUN)).body.code).toBe("status_cancelled");
    expect(d.calls).not.toContain("extract");
  });
  it("ikke-PDF og ugyldig leser-svar merker kjøringen feilet", async () => {
    const d1 = deps({ download: async () => new TextEncoder().encode("<html>".repeat(30)) });
    expect((await runPreview(d1, USER, RUN)).body.code).toBe("ikke_pdf");
    expect(d1.calls).toContain("fail:ikke_pdf");
    const d2 = deps({ extract: async () => ({ ok: true, status: 200, json: { nope: 1 } }) });
    expect((await runPreview(d2, USER, RUN)).body.code).toBe("leser_ugyldig_svar");
    expect(d2.calls).toContain("fail:leser_ugyldig_svar");
  });
  it("ukjent registreringsutfall merkes ikke feilet", async () => {
    const d = deps({ register: async () => "unknown" });
    const r = await runPreview(d, USER, RUN);
    expect(r.body.code).toBe("ukjent_utfall");
    expect(d.calls.some((c) => c.startsWith("fail"))).toBe(false);
  });
  it("snapshot endret rapporteres uten ny feil-markering", async () => {
    const d = deps({ register: async () => ({ ok: false, code: "snapshot_endret" }) });
    expect((await runPreview(d, USER, RUN)).body.code).toBe("snapshot_endret");
  });
  it("sender lagret signert snapshot og eksisterende varenavn til leseren", async () => {
    const extract = vi.fn(async () => ({ ok: true, status: 200, json: resp }));
    await runPreview(deps({ extract }), USER, RUN);
    const body = extract.mock.calls[0][0] as Record<string, unknown>;
    expect(body.known_items).toEqual([{ sku: "A1", name: "Mel" }]);
    expect(body.supplier_id).toBe(OTHER);
    expect(typeof body.pdf_base64).toBe("string");
    expect(body.max_attempts).toBe(2);
  });
});
