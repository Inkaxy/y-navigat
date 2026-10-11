// @vitest-environment jsdom
/** Fase 5A-reparasjon: faktiske hjelpere/parsere/komponenter med mocket I/O. Ingen ekte skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const trackCalls: unknown[] = [];
const backfillCalls: unknown[] = [];
const notesMutate = vi.fn();
vi.mock("@/ravarer/hooks/useSuppliers", () => ({
  useSetTrackInvoiceLines: () => ({ isPending: false, mutate: (v: unknown) => trackCalls.push(v), mutateAsync: async (v: unknown) => { trackCalls.push(v); } }),
  useBackfillSupplierInvoices: () => ({ isPending: false, mutate: (v: unknown) => backfillCalls.push(v) }),
}));
vi.mock("@/ravarer/hooks/useSupplierDetail", () => ({
  useUpdateSupplierNotes: () => ({ isPending: false, mutate: notesMutate }),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const P = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    AlertDialogContent: P, AlertDialogHeader: P, AlertDialogFooter: P, AlertDialogTitle: P, AlertDialogDescription: P,
    AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
    AlertDialogAction: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  };
});

import { agreementBaseUnitsPerPackage } from "@/ravarer/lib/agreementPricing";
import { parseApplyAgreementResult } from "@/ravarer/lib/agreementResult";
import { parseChangeLinkStrict } from "@/ravarer/pages/priskontroll/gjore/rpc";
import { fetchAllCounted, IncompleteFetchError } from "@/lib/countedPaging";
import { summarizeSpend, spendShare } from "@/ravarer/lib/supplierSpend";
import { fakturaReturn, readReturnParam } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { TrackInvoiceToggle } from "@/ravarer/components/supplier/TrackInvoiceToggle";
import { SupplierNotesSection } from "@/ravarer/components/supplier/SupplierNotesSection";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { trackCalls.length = 0; backfillCalls.length = 0; notesMutate.mockReset(); });

describe("avtalepris på tvers av dimensjoner", () => {
  it("kg→l gir ukjent; eksplisitt innhold vinner; samme dimensjon regnes om; ukjent pakningsenhet beholdes", () => {
    expect(agreementBaseUnitsPerPackage("", "10", "kg", "l")).toBeNull();
    expect(agreementBaseUnitsPerPackage("", "10", "stk", "kg")).toBeNull();
    expect(agreementBaseUnitsPerPackage("8", "10", "kg", "l")).toBe(8);
    expect(agreementBaseUnitsPerPackage("", "500", "g", "kg")).toBe(0.5);
    expect(agreementBaseUnitsPerPackage("", "1", "sekk", "kg")).toBe(1);
  });
});

describe("rm_apply_agreement-svar", () => {
  const ok = { ok: true, link_id: U1, agreed_price: 100, agreed_price_per_base_unit: null, is_primary: true };
  it("godtar live-formen, null og null-pris", () => {
    expect(parseApplyAgreementResult(ok)?.linkId).toBe(U1);
    expect(parseApplyAgreementResult({ ...ok, agreed_price: 0 })?.agreedPrice).toBe(0);
  });
  it.each([[{}], [null], [[ok]], [{ ...ok, ok: false }], [{ ...ok, link_id: "x" }], [{ ok: true, link_id: U1, agreed_price: 1, is_primary: true }], [{ ...ok, agreed_price: Infinity }], [{ ...ok, is_primary: "true" }]])("avviser %j som ukjent", (v) => {
    expect(parseApplyAgreementResult(v)).toBeNull();
  });
});

describe("rm_change_supplier_link-svar", () => {
  it("null linjer + rematch null er suksess; låst alene er suksess; queued 0 er gyldig", () => {
    expect(parseChangeLinkStrict({ ok: true, changed_line_ids: [], locked_lines: 0, rematch: null }, null)?.ok).toBe(true);
    expect(parseChangeLinkStrict({ ok: true, changed_line_ids: [], locked_lines: 2, rematch: null }, [U1])?.lockedLines).toBe(2);
    expect(parseChangeLinkStrict({ ok: true, changed_line_ids: [U1], locked_lines: 0, rematch: { ok: true, queued: 0, already_queued: 1, pending: 1 } }, [U1, U2])?.changedLineIds).toEqual([U1]);
  });
  it("avviser {}, ok:false, feil ID, brøk/negativ teller, ugyldig rematch og linje utenfor utvalget", () => {
    for (const v of [{}, { ok: false }, { ok: true, changed_line_ids: ["x"], locked_lines: 0, rematch: null },
      { ok: true, changed_line_ids: [], locked_lines: 1.5, rematch: null }, { ok: true, changed_line_ids: [], locked_lines: -1, rematch: null },
      { ok: true, changed_line_ids: [U1], locked_lines: 0, rematch: { ok: true, queued: 1 } }]) expect(parseChangeLinkStrict(v, [U1])).toBeNull();
    expect(parseChangeLinkStrict({ ok: true, changed_line_ids: [U2], locked_lines: 0, rematch: null }, [U1])).toBeNull();
  });
});

describe("komplett henting med serverbegrensning under sidestørrelse", () => {
  const ids = Array.from({ length: 1201 }, (_, i) => `id-${String(i).padStart(5, "0")}`);
  const src = (cap: number, opts: { count?: () => number | null; failPage?: number } = {}) => {
    let pages = 0;
    return {
      count: async () => ({ data: null, error: null, count: opts.count ? opts.count() : ids.length }),
      page: async (after: string | null) => {
        pages += 1;
        if (opts.failPage === pages) return { data: null, error: new Error("x") };
        const start = after ? ids.indexOf(after) + 1 : 0;
        return { data: ids.slice(start, start + cap).map((id) => ({ id })), error: null };
      },
    };
  };
  it("henter alle 1201 rader med tak 137 og forespurt 500", async () => {
    expect((await fetchAllCounted({ ...src(137), pageSize: 500 })).length).toBe(1201);
  });
  it("tellerfeil, sidefeil, endret antall og avbrudd gir feil, aldri delsum", async () => {
    await expect(fetchAllCounted(src(137, { count: () => null }))).rejects.toBeInstanceOf(IncompleteFetchError);
    await expect(fetchAllCounted(src(137, { failPage: 2 }))).rejects.toBeInstanceOf(IncompleteFetchError);
    let n = 0;
    await expect(fetchAllCounted(src(500, { count: () => (n++ === 0 ? 1201 : 1202) }))).rejects.toMatchObject({ reason: "changed" });
    const ac = new AbortController(); ac.abort();
    await expect(fetchAllCounted({ ...src(500), signal: ac.signal })).rejects.toMatchObject({ reason: "aborted" });
  });
});

describe("innkjøpsgrunnlag", () => {
  const r = (o: Partial<{ status: string; currency: string | null; total_amount: number | null; total_vat: number | null; is_credit_note: boolean }>) =>
    ({ id: Math.random().toString(), status: "imported", currency: "NOK", total_amount: 125, total_vat: 25, is_credit_note: false, ...o });
  it("faktura +100, kreditnota −100, kjent 0 mva gyldig", () => {
    expect(summarizeSpend([r({}), r({ is_credit_note: true })], "a", "b").netNok).toBe(0);
    expect(summarizeSpend([r({ total_vat: 0, total_amount: 50 })], "a", "b").netNok).toBe(50);
  });
  it("manglende mva/beløp eller negativt beløp gir ukjent total med kjent delsum", () => {
    const s = summarizeSpend([r({}), r({ total_vat: null })], "a", "b");
    expect(s.netNok).toBeNull(); expect(s.missingVatCount).toBe(1); expect(s.knownNetNokSubtotal).toBe(100);
    expect(summarizeSpend([r({ total_amount: -125 })], "a", "b").netNok).toBeNull();
  });
  it("annen valuta og kansellert telles separat; andel bare ved komplett, ren NOK", () => {
    const s = summarizeSpend([r({}), r({ currency: "EUR" }), r({ currency: null }), r({ status: "cancelled" })], "a", "b");
    expect(s.otherCurrencyCount).toBe(2); expect(s.excludedCancelledCount).toBe(1);
    const a = summarizeSpend([r({})], "a", "b"); const t = summarizeSpend([r({}), r({}), r({}), r({})], "a", "b");
    expect(spendShare(a, t)).toBe(25);
    expect(spendShare(s, t)).toBeNull();
    expect(spendShare(a, summarizeSpend([r({})], "a", "c"))).toBeNull();
    expect(summarizeSpend([], "a", "b").netNok).toBe(0);
  });
});

describe("retur fra faktura", () => {
  it("leverandørkort og lager beholdes med etikett; eksterne og protokoll-relative avvises; dato-fra ignoreres", () => {
    const sup = "/ravarer/leverandorer/abc-1?seksjon=fakturaer&liste=q%3DIdun%26valgt%3Dabc-1";
    expect(fakturaReturn(readReturnParam(new URLSearchParams({ fra: sup })))).toEqual({ href: sup, label: "Leverandør" });
    expect(fakturaReturn("/ravarer/lager?fane=varemottak").label).toBe("Lager");
    expect(fakturaReturn("//evil.com/x").href).toBe("/ravarer/priskontroll?fane=fakturaer");
    expect(fakturaReturn("https://evil.com").href).toBe("/ravarer/priskontroll?fane=fakturaer");
    expect(fakturaReturn("?fane=gjore&visning=mengde")).toEqual({ href: "/ravarer/priskontroll?fane=gjore&visning=mengde", label: "Å gjøre" });
    expect(readReturnParam(new URLSearchParams({ fra: "2026-01-01" }))).toBeNull();
  });
});

describe("Følg fakturalinjer", () => {
  const sup = { id: "supplier-A", name: "A", track_invoice_lines: false };
  it("tilgangstap etter åpnet bekreftelse sperrer handlingen", () => {
    const { rerender } = render(<TrackInvoiceToggle supplier={sup} canWrite />);
    fireEvent.click(screen.getByRole("switch"));
    rerender(<TrackInvoiceToggle supplier={sup} canWrite={false} />);
    const btn = screen.getByText("Slå på og hent 12 måneder");
    expect(btn).toHaveProperty("disabled", true);
    fireEvent.click(btn);
    expect(trackCalls).toHaveLength(0);
  });
  it("dobbelttrykk i samme render gir ett kall og nøyaktig mål", async () => {
    render(<TrackInvoiceToggle supplier={sup} canWrite />);
    fireEvent.click(screen.getByRole("switch"));
    const btn = screen.getByText("Slå på og hent 12 måneder");
    await act(async () => { btn.click(); btn.click(); });
    expect(trackCalls).toEqual([{ id: "supplier-A", value: true }]);
    expect(backfillCalls).toEqual([{ supplierId: "supplier-A", months: 12 }]);
  });
});

describe("Notater", () => {
  it("vellykket lagring beholder innsendt tekst selv om bufret leverandør fortsatt er gammel", () => {
    const s = { id: "A", notes: "old A" } as SupplierRow;
    function Host() { const [, set] = useState(false); return <SupplierNotesSection supplier={s} canWrite onDirtyChange={set} />; }
    render(<Host />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "saved edit" } });
    fireEvent.click(screen.getByText("Lagre notat"));
    const opts = notesMutate.mock.calls[0][1] as { onSuccess: () => void };
    act(() => opts.onSuccess());
    expect((ta as HTMLTextAreaElement).value).toBe("saved edit");
    expect(screen.getByText("Lagret")).toBeTruthy();
  });
});
