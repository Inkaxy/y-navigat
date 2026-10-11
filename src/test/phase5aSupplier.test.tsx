// @vitest-environment jsdom
/** Fase 5A: aliasredigering (mocket RPC), avtaleskjema, seksjoner/listekontekst, filter, valuta. Ingen ekte skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let editReply: () => { data: unknown; error: unknown } = () => ({ data: null, error: null });
let previewStatus = "pending";
let editGate: Promise<void> | null = null;
const preview = (id = "A1", status = previewStatus, token = "tok1") => ({
  schema_version: 1, alias_id: id, rms_id: "L1", raw_material_id: "RM1", supplier_id: "S1", legal_entity_id: "E", alias_type: "supplier_sku",
  alias_value: "123", status, edit_revision: 0, match_count: 0, last_seen_at: null, expected_snapshot: token, confirmed_by: null, confirmed_at: null,
  rejected_by: null, rejected_at: null, rejected_reason: null, can_edit: true, scope: "future_matching_only",
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "rm_supplier_alias_edit_preview") return { data: preview(), error: null };
      if (editGate) await editGate;
      return editReply();
    },
  },
}));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRavarerCounts: () => undefined }));

import { AliasEditDialog } from "@/ravarer/components/supplier/AliasEditDialog";
import { aliasActions, classifyAliasError, parseAliasEditResult, parseAliasPreview } from "@/ravarer/lib/supplierAliasEdit";
import { agreementFormError, derivePricePerBaseUnit } from "@/ravarer/lib/agreementForm";
import { listReturnSearch, readSupplierSection, supplierSectionSearch } from "@/ravarer/lib/supplierSections";
import { filterSuppliers } from "@/ravarer/pages/Leverandorer";
import { invoiceAmount } from "@/ravarer/components/supplier/SupplierInvoicesSection";
import { spendSummary } from "@/ravarer/hooks/useSupplierDetail";
import { aliasHits } from "@/ravarer/components/supplier/SupplierAliasesSection";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { calls.length = 0; previewStatus = "pending"; editGate = null; });

describe("aliaskontrakt", () => {
  it("forhåndsvisning må gjelde forespurt alias/kobling og schema 1", () => {
    expect(parseAliasPreview(preview(), "A1", "L1")).not.toBeNull();
    expect(parseAliasPreview(preview(), "A1", "L2")).toBeNull();
    expect(parseAliasPreview({ ...preview(), schema_version: 2 }, "A1", "L1")).toBeNull();
    expect(parseAliasPreview({ ...preview(), can_edit: "true" }, "A1", "L1")).toBeNull();
  });
  it("handlinger: erstattet er skrivebeskyttet; EAN kan ikke bekreftes; uten rett ingenting", () => {
    expect([...aliasActions({ status: "superseded", aliasType: "supplier_sku", canEdit: true })]).toEqual([]);
    expect(aliasActions({ status: "pending", aliasType: "ean", canEdit: true }).has("confirm")).toBe(false);
    expect([...aliasActions({ status: "rejected", aliasType: "product_name", canEdit: true })].sort()).toEqual(["confirm", "replace"]);
    expect([...aliasActions({ status: "pending", aliasType: "supplier_sku", canEdit: false })]).toEqual([]);
  });
  it("resultat: retting krever ny ID, «Venter», 0 treff og 0 faktura-/kostendringer; ellers ukjent", () => {
    const ok = { ok: true, action: "replace", alias: preview("A2", "pending"), invoice_lines_changed: 0, cost_prices_changed: 0 };
    expect(parseAliasEditResult(ok, "replace", "A1", "L1")?.alias.aliasId).toBe("A2");
    expect(parseAliasEditResult({ ...ok, alias: preview("A1", "pending") }, "replace", "A1", "L1")).toBeNull();
    expect(parseAliasEditResult({ ...ok, invoice_lines_changed: 1 }, "replace", "A1", "L1")).toBeNull();
    expect(parseAliasEditResult({}, "confirm", "A1", "L1")).toBeNull();
    expect(parseAliasEditResult({ ok: true, action: "confirm", alias: preview("A1", "pending"), invoice_lines_changed: 0, cost_prices_changed: 0 }, "confirm", "A1", "L1")).toBeNull();
  });
  it("feilkoder", () => {
    expect(classifyAliasError({ code: "40001", message: "x" }).kind).toBe("stale");
    expect(classifyAliasError({ code: "23505", message: "x" }).kind).toBe("duplicate");
    expect(classifyAliasError({ code: "42501", message: "x" }).kind).toBe("denied");
    expect(classifyAliasError({ code: "22023", message: "Aliasverdien er uendret" }).message).toBe("Aliasverdien er uendret");
    expect(classifyAliasError(new TypeError("Failed to fetch")).kind).toBe("unknown");
  });
});

function openDialog(onSaved = vi.fn()) {
  render(<AliasEditDialog target={{ aliasId: "A1", rmsId: "L1", materialName: "Mel" }} supplierId="S1" onClose={() => undefined} onSaved={onSaved} />, { wrapper: wrap });
  return onSaved;
}

describe("AliasEditDialog", () => {
  it("leser forhåndsvisning med alias+kobling og sender token, handling og begrunnelse; ingen ny verdi ved bekreft", async () => {
    editReply = () => ({ data: { ok: true, action: "confirm", alias: preview("A1", "confirmed", "tok2"), invoice_lines_changed: 0, cost_prices_changed: 0 }, error: null });
    const saved = openDialog();
    await screen.findByText("Ingen observerte treff");
    expect(calls[0]).toEqual({ fn: "rm_supplier_alias_edit_preview", args: { p_alias_id: "A1", p_rms_id: "L1" } });
    fireEvent.click(screen.getByLabelText(/Bekreft alias/));
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "Riktig varenr" } });
    fireEvent.click(screen.getByRole("button", { name: "Bekreft alias" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const edit = calls.find((c) => c.fn === "rm_edit_supplier_alias");
    expect(edit?.args).toMatchObject({ p_alias_id: "A1", p_rms_id: "L1", p_expected_snapshot: "tok1", p_action: "confirm", p_reason: "Riktig varenr" });
    expect(edit?.args.p_new_value).toBeUndefined();
  });
  it("40001: utkast beholdes, forhåndsvisning hentes på nytt, ingen lagring meldt", async () => {
    editReply = () => ({ data: null, error: { code: "40001", message: "x" } });
    const saved = openDialog();
    await screen.findByText("Ingen observerte treff");
    fireEvent.click(screen.getByLabelText(/Rett aliasverdi/));
    fireEvent.change(screen.getByLabelText("Ny verdi"), { target: { value: "124" } });
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "Skrivefeil" } });
    fireEvent.click(screen.getByRole("button", { name: "Rett aliasverdi" }));
    expect(await screen.findByTestId("alias-failure")).toHaveTextContent(/endret siden/);
    expect((screen.getByLabelText("Ny verdi") as HTMLInputElement).value).toBe("124");
    expect(saved).not.toHaveBeenCalled();
    await waitFor(() => expect(calls.filter((c) => c.fn === "rm_supplier_alias_edit_preview").length).toBeGreaterThanOrEqual(2));
  });
  it("ukjent utfall (tomt svar): ingen «lagret», krever ny lesing før nytt forsøk; dobbelttrykk gir ett kall", async () => {
    let release!: () => void;
    editGate = new Promise((r) => { release = r; });
    editReply = () => ({ data: {}, error: null });
    const saved = openDialog();
    await screen.findByText("Ingen observerte treff");
    fireEvent.click(screen.getByLabelText(/Avvis alias/));
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "Feil vare" } });
    const btn = screen.getByRole("button", { name: "Avvis alias" });
    fireEvent.click(btn); fireEvent.click(btn);
    release();
    expect(await screen.findByRole("button", { name: "Hent aliaset på nytt" })).toBeTruthy();
    expect(calls.filter((c) => c.fn === "rm_edit_supplier_alias")).toHaveLength(1);
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("avtaleskjema", () => {
  it("100 kr / 10 kg → 10 kr/kg; ugyldig/manglende input tømmer avledet verdi", () => {
    expect(derivePricePerBaseUnit("100", "package", 10)).toBe("10.0000");
    expect(derivePricePerBaseUnit("", "package", 10)).toBe("");
    expect(derivePricePerBaseUnit("100", "package", null)).toBe("");
    expect(derivePricePerBaseUnit("abc", "base", 10)).toBe("");
  });
  it("validering før opplasting: pris og datoer", () => {
    expect(agreementFormError({ agreedPrice: "", pricePerBaseUnit: "", validFrom: "", validTo: "" })).toMatch(/avtalepris/);
    expect(agreementFormError({ agreedPrice: "100", pricePerBaseUnit: "10", validFrom: "2026-10-10", validTo: "2026-10-01" })).toMatch(/Sluttdato/);
    expect(agreementFormError({ agreedPrice: "100", pricePerBaseUnit: "10", validFrom: "2026-10-01", validTo: "" })).toBeNull();
  });
});

describe("seksjoner, liste og valuta", () => {
  it("ukjent seksjon → oversikt; seksjonsbytte beholder listekontekst; retur slipper bare kjente parametere", () => {
    expect(readSupplierSection(new URLSearchParams("seksjon=tull"))).toBe("oversikt");
    expect(readSupplierSection(new URLSearchParams("seksjon=aliaser"))).toBe("aliaser");
    expect(supplierSectionSearch(new URLSearchParams("liste=q%3Didun"), "fakturaer")).toBe("?liste=q%3Didun&seksjon=fakturaer");
    expect(listReturnSearch(new URLSearchParams("liste=q%3Didun%26valgt%3DS1%26x%3D1"))).toBe("?q=idun&valgt=S1");
  });
  const s = (o: Partial<SupplierRow>): SupplierRow => ({ id: "x", legal_entity_id: "E", name: "A", org_number: null, contact_email: null, contact_phone: null, is_active: true, notes: null, track_invoice_lines: false, tripletex_is_inactive: false, tripletex_supplier_number: null, tripletex_synced_at: null, last_invoice_date: null, invoice_count: null, ...o });
  it("filter: inaktive skjules uten «Vis inaktive»; følges/aktive som før", () => {
    const rows = [s({ id: "1", track_invoice_lines: true }), s({ id: "2", is_active: false }), s({ id: "3", tripletex_is_inactive: true })];
    expect(filterSuppliers(rows, "", "alle", false).map((r) => r.id)).toEqual(["1"]);
    expect(filterSuppliers(rows, "", "alle", true).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(filterSuppliers(rows, "", "folges", true).map((r) => r.id)).toEqual(["1"]);
    expect(filterSuppliers(rows, "", "aktive", true).map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("valuta: bare NOK vises som kroner og summeres", () => {
    expect(invoiceAmount({ total_amount: 100, currency: "EUR" })).toBe("100 EUR");
    expect(invoiceAmount({ total_amount: 100, currency: null })).toMatch(/valuta ukjent/);
    expect(invoiceAmount({ total_amount: 100, currency: "NOK" })).toMatch(/kr/);
    expect(spendSummary([
      { total_amount: 125, total_vat: 25, is_credit_note: false, currency: "NOK" },
      { total_amount: 50, total_vat: 0, is_credit_note: false, currency: "EUR" },
    ])).toEqual({ nok: 100, otherCurrencyCount: 1 });
    expect(aliasHits({ match_count: 0, last_seen_at: "2026-01-01" })).toBe("Ingen observerte treff");
  });
});
