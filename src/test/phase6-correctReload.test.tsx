// @vitest-environment jsdom
/**
 * Ekte CorrectLineDialog: «Last inn ferske verdier» venter på vellykket, ferdig og samsvarende fersk lesing før
 * utkast og grunnlag byttes atomisk; feil eller byttet kontekst beholder utkastet. Første grunnlag krever ferdig svar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

type Res = { data: unknown; isSuccess: boolean; isFetching: boolean; isError: boolean };
type Q = Res & { isLoading: boolean; refetch: () => Promise<Res> };
const st = vi.hoisted(() => ({ q: null as unknown as Q, mutate: vi.fn(), refetch: vi.fn() }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useLineCorrection", () => ({
  useCorrectionLine: () => st.q,
  useCorrectLine: () => ({ mutateAsync: st.mutate, isPending: false }),
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/ExtractionExamplesList", () => ({ ExtractionExamplesList: () => null }));

import { CorrectLineDialog } from "@/ravarer/pages/priskontroll/faktura/CorrectLineDialog";

const row = (rev: string, quantity: number) => ({
  id: "A", invoice_id: "I1", line_number: 2, updated_at: rev, costPosted: false, issues: [],
  values: { supplier_sku: null, description: "HASSELNØTT", quantity, unit: "kg", package_size: null, package_unit: null, count_per_package: null, unit_price: 113, total_amount: 1130, line_kind: "vare", unit_price_basis: "", discount_amount: null },
});
const ok = (data: unknown, over: Partial<Q> = {}): Q => ({ data, isSuccess: true, isFetching: false, isError: false, isLoading: false, refetch: st.refetch, ...over });
const inv = { id: "I1", status: "needs_review", approved: false, supplier_id: "S1", supplier_name: "PALS" };
const el = (open = true, lineId = "A") => <CorrectLineDialog open={open} onOpenChange={() => undefined} lineId={lineId} targetInvoiceId="I1" invoice={inv} canWrite document={<div />} onSaved={() => undefined} />;
const qty = () => (document.getElementById("rett-quantity") as HTMLInputElement).value;
function deferred() { let resolve!: (v: Res) => void; const p = new Promise<Res>((r) => { resolve = r; }); return { p, resolve }; }

beforeEach(() => { cleanup(); st.refetch.mockReset(); st.mutate.mockReset(); });

function conflict() {
  st.q = ok(row("v1", 10));
  const r = render(el());
  fireEvent.change(document.getElementById("rett-quantity") as HTMLInputElement, { target: { value: "3" } });
  st.q = ok(row("v2", 4));
  r.rerender(el());
  return r;
}

describe("Last inn ferske verdier", () => {
  it("første grunnlag lages ikke fra bufret data under henting", () => {
    st.q = ok(row("v1", 10), { isFetching: true });
    const r = render(el());
    expect(document.getElementById("rett-quantity")).toBeNull();
    st.q = ok(row("v1", 10));
    r.rerender(el());
    expect(qty()).toBe("10");
  });

  it("venter på fersk lesing: bufret v2 tas ikke i bruk mens hentingen pågår; v3 adopteres atomisk", async () => {
    const r = conflict();
    const d = deferred();
    st.refetch.mockReturnValue(d.p);
    fireEvent.click(screen.getByRole("button", { name: "Last inn ferske verdier" }));
    st.q = ok(row("v2", 4), { isFetching: true });
    r.rerender(el());
    expect(qty()).toBe("3");
    st.q = ok(row("v3", 5));
    await act(async () => { d.resolve({ data: row("v3", 5), isSuccess: true, isError: false, isFetching: false }); });
    r.rerender(el());
    expect(qty()).toBe("5");
    expect(screen.queryByText(/endret siden du åpnet/)).toBeNull();
  });

  it("feilet fersk lesing beholder utkast og konflikt", async () => {
    const r = conflict();
    st.refetch.mockResolvedValue({ data: row("v2", 4), isSuccess: false, isError: true, isFetching: false });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Last inn ferske verdier" })); });
    r.rerender(el());
    expect(qty()).toBe("3");
    expect(screen.getByText(/Kunne ikke hente ferske verdier/)).toBeTruthy();
    expect(screen.getByText(/endret siden du åpnet/)).toBeTruthy();
  });

  it("svar for annen linje eller etter lukking tas ikke i bruk", async () => {
    const r = conflict();
    const d = deferred();
    st.refetch.mockReturnValue(d.p);
    fireEvent.click(screen.getByRole("button", { name: "Last inn ferske verdier" }));
    r.rerender(el(false));
    await act(async () => { d.resolve({ data: row("v3", 5), isSuccess: true, isError: false, isFetching: false }); });
    r.rerender(el(true));
    expect(qty()).toBe("3");
  });

  it("dobbelt trykk henter én gang", async () => {
    conflict();
    const d = deferred();
    st.refetch.mockReturnValue(d.p);
    const b = screen.getByRole("button", { name: "Last inn ferske verdier" });
    fireEvent.click(b); fireEvent.click(b);
    expect(st.refetch).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve({ data: row("v3", 5), isSuccess: true, isError: false, isFetching: false }); });
  });
});
