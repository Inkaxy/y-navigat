// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, renderHook, act, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn(async () => ({ data: [], error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => rpc() } }));
let userId: string | null = "u1";
vi.mock("@/hooks/useAuth", () => ({ useAuthUserId: () => userId }));

import { gateWithRows, type SafetyResult, type GateFor } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { parsePriceSafety } from "@/fakturaer/lib/priceSafety";
import { ownLineGate } from "@/ravarer/pages/priskontroll/faktura/ownLineGate";
import { useClaimFlow } from "@/ravarer/pages/priskontroll/gjore/useClaimFlow";
import { ClaimSubmitError, type ClaimPreviewLine } from "@/ravarer/lib/supplierClaim";
import { CaseEmailDraft, retainedDraftEdits } from "@/ravarer/pages/priskontroll/saker/CaseEmailDraft";
import type { DraftInput } from "@/fakturaer/lib/supplierCaseDraft";

const V1 = "2026-10-11T10:00:00.000001+00:00";
const V2 = "2026-10-11T10:00:00.000002+00:00";
const okLine = (version: string) => ({ line_id: "l1", line_version: version, raw_material_id: "rmB", can_compare: true, effect_nok: 0, reason_code: null,
  reference_source: "agreement", reference_id: "a", base_unit: "kg", currency: "NOK", reference_date: null, expected_price_per_base_unit: 10, price_per_base_unit: 10, base_quantity: 5 });
const receipt = (version: string) => ({ schema_version: 2, invoice_id: "i1", legal_entity_id: "e1", checked_at: new Date().toISOString(), lines: [okLine(version)] });
// Detalj-cache og kvittering er på B/versjon 2 (som i arbeidsflaten).
const data = (version: string): SafetyResult => ({ ...parsePriceSafety(receipt(version), "i1")!, received_at: Date.now(), rows: new Map([["l1", { updated_at: version, raw_material_id: "rmB" }]]) });
const workspaceGate = (version: string): GateFor => ownLineGate((l) => gateWithRows(data(version), true, l), "i1");

describe("arbeidsflatens prisport binder kallerens egen rad", () => {
  it("kø-rad A/v1 mot fersk detalj/kvittering B/v2 er ukjent; etter oppfrisking til B/v2 synlig", () => {
    const gate = workspaceGate(V2);
    expect(gate({ id: "l1", invoice_id: "i1", updated_at: V1, raw_material_id: "rmA" }).ok).toBe(false);
    expect(gate({ id: "l1", invoice_id: "i1", updated_at: V2, raw_material_id: "rmB" }).ok).toBe(true);
  });
  it("omvendt rekkefølge: kø på v2, kvittering fortsatt v1 → ukjent", () => {
    expect(workspaceGate(V1)({ id: "l1", invoice_id: "i1", updated_at: V2, raw_material_id: "rmB" }).ok).toBe(false);
  });
  it("bare mikrosekundendring er ukjent", () => {
    expect(workspaceGate(V2)({ id: "l1", invoice_id: "i1", updated_at: V1, raw_material_id: "rmB" }).ok).toBe(false);
  });
  it("manglende egen versjon/råvare lånes ikke — ukjent", () => {
    expect(workspaceGate(V2)({ id: "l1", invoice_id: "i1" }).ok).toBe(false);
    expect(workspaceGate(V2)({ id: "l1", invoice_id: "i1", updated_at: V2 }).ok).toBe(false);
  });
  it("rad fra annen faktura sertifiseres ikke", () => {
    expect(workspaceGate(V2)({ id: "l1", invoice_id: "i2", updated_at: V2, raw_material_id: "rmB" }).ok).toBe(false);
  });
});

describe("kravflyt: sen duplikatoppslag", () => {
  const line: ClaimPreviewLine = { line_id: "x" } as unknown as ClaimPreviewLine;
  it("lukket dialog åpnes ikke igjen av sent oppslag", async () => {
    let resolve!: (v: string | null) => void;
    const findOpenCase = () => new Promise<string | null>((r) => { resolve = r; });
    const { result } = renderHook(() => useClaimFlow({ preview: async () => [line], findOpenCase }));
    let p!: Promise<string | null>;
    act(() => { p = result.current.onSubmitError(new ClaimSubmitError("duplicate", "d")); });
    act(() => result.current.close());
    await act(async () => { resolve("gammel-sak"); await p; });
    expect(result.current.open).toBe(false);
    expect(result.current.state.duplicate).toBeNull();
  });
});

describe("kladdeminne avgrenset per bruker", () => {
  const input = { kind: "documented_claim" } as unknown as DraftInput;
  it("bruker-bytte tømmer ulagrede endringer", async () => {
    retainedDraftEdits.clear();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["supplier-case-drafts", "A"], []);
    const ui = () => <QueryClientProvider client={qc}><MemoryRouter><CaseEmailDraft caseId="A" canWrite input={input} /></MemoryRouter></QueryClientProvider>;
    const r = render(ui());
    const subject = screen.getAllByRole("textbox")[0];
    fireEvent.change(subject, { target: { value: "Hemmelig A-tekst" } });
    expect([...retainedDraftEdits.keys()]).toEqual(["u1|A"]);
    userId = "u2";
    r.rerender(ui());
    expect(retainedDraftEdits.size).toBe(0);
    expect(screen.queryByDisplayValue("Hemmelig A-tekst")).toBeNull();
    userId = "u1";
  });
});
