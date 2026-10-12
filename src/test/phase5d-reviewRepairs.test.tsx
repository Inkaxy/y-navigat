// @vitest-environment jsdom
/** 5D-reviewreparasjoner: faktiske hooks/komponenter med mocket I/O. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const st = vi.hoisted(() => ({
  entity: "A",
  rpcData: 1 as unknown,
  rpc: vi.fn(),
  statusRead: null as null | Promise<void>,
  invoke: vi.fn(),
  updates: [] as Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }>,
  updateError: null as null | { message: string },
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let patch: unknown = null;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      in: (c: string, v: unknown) => { filters.push([c, v]); return q; },
      order: () => q, limit: () => q,
      update: (p: unknown) => { patch = p; return q; },
      maybeSingle: async () => {
        if (st.statusRead) await st.statusRead;
        return { data: { status: "draft", legal_entity_id: "A", rfq_issued_at: null }, error: null };
      },
      then: (res: (v: unknown) => void) => {
        if (patch) { st.updates.push({ table, patch, filters }); return res({ data: null, error: st.updateError }); }
        return res({ data: [], error: null });
      },
    };
    return q;
  };
  return { supabase: {
    from,
    rpc: (...a: unknown[]) => { st.rpc(...a); return Promise.resolve({ data: st.rpcData, error: null }); },
    functions: { invoke: (...a: unknown[]) => st.invoke(...a) },
  } };
});
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: st.entity, user: { id: "U" }, canWrite: true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRawMaterial: vi.fn() }));

import { useUpsertNegotiationItems, NegotiationContextChangedError, NegotiationUncertainReceiptError } from "@/ravarer/hooks/useNegotiations";
import { LiveConfirmationStatus } from "@/ravarer/pages/forhandlinger/detail/LiveConfirmationStatus";
import { SavingsValue } from "@/ravarer/pages/forhandlinger/detail/SavingsValue";
import { offerPricePerBaseUnit } from "@/ravarer/lib/negotiationMatrix";
import { canReplaceNegotiationItems, classifyApplyOutcome, estimateSavings, negotiationListReturn, parseRfqCredentials } from "@/ravarer/lib/negotiationOps";
import type { NegotiationItemRow, NegotiationRecipientRow, NegotiationRow } from "@/ravarer/hooks/useNegotiations";

function client() { return new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } }); }
function wrap(qc = client()) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => { st.entity = "A"; st.rpcData = 1; st.rpc.mockClear(); st.statusRead = null; st.invoke.mockReset(); st.updates = []; st.updateError = null; });

describe("tilbudsomregning og besparelse", () => {
  it("manglende pris blir aldri 0 og slår aldri et gyldig tilbud", () => {
    expect(offerPricePerBaseUnit({ offeredPrice: null, baseUnit: "kg" }).value).toBeNull();
    expect(offerPricePerBaseUnit({ offeredPrice: 40, baseUnit: null }).value).toBeNull();
    expect(offerPricePerBaseUnit({ offeredPrice: 0, baseUnit: "kg" }).value).toBe(0);
  });
  it("liter mot kg regnes aldri om via pakningstall; 500 g gir 200/kg", () => {
    expect(offerPricePerBaseUnit({ offeredPrice: 100, offeredPackageSize: 10, offeredPackageUnit: "l", baseUnit: "kg", linkBaseUnitsPerPackage: 20 }).value).toBeNull();
    expect(offerPricePerBaseUnit({ offeredPrice: 100, offeredPackageSize: 500, offeredPackageUnit: "g", baseUnit: "kg" }).value).toBeCloseTo(200);
  });
  it("ugyldig baseline er ukjent, aldri 0", () => {
    expect(estimateSavings([{ hasWinner: true, winnerPerBase: 40, volumeBaseline: 100, costBaseline: Number.NaN }])).toEqual({ value: 0, known: 0, unknown: 1 });
  });
  it("detaljens KPI sier «Ingen tilbud å beregne» uten tilbud, og venter ved lasting", () => {
    const { rerender } = render(<SavingsValue loading={false} failed={false} known={0} unknown={0} value={0} />);
    expect(screen.getByText("Ingen tilbud å beregne")).toBeTruthy();
    expect(screen.queryByText(/0,00/)).toBeNull();
    rerender(<SavingsValue loading failed={false} known={1} unknown={0} value={50} />);
    expect(screen.queryByText(/50/)).toBeNull();
    rerender(<SavingsValue loading={false} failed known={1} unknown={0} value={50} />);
    expect(screen.getByText(/Kunne ikke beregnes/)).toBeTruthy();
  });
});

describe("kontrakter", () => {
  const exp = [{ id: "r1", supplier_id: "s1" }];
  it("lenke som peker på et annet token avvises", () => {
    const bad = { success: true, credentials: [{ recipient_id: "r1", supplier_id: "s1", access_token: "t1", password: "p", portal_url: "https://x/tilbud/t2" }] };
    expect(parseRfqCredentials(bad, exp).kind).toBe("malformed");
    const ok = { success: true, credentials: [{ recipient_id: "r1", supplier_id: "s1", access_token: "t1", password: "p", portal_url: "https://x/tilbud/t1" }] };
    expect(parseRfqCredentials(ok, exp).kind).toBe("ok");
  });
  it("applied må være ikke-negativt heltall", () => {
    expect(classifyApplyOutcome({ success: true, applied: 1.5 }, null).kind).toBe("unknown");
    expect(classifyApplyOutcome({ success: true, applied: -1 }, null).kind).toBe("unknown");
    expect(classifyApplyOutcome({ success: true, applied: 0 }, null).kind).toBe("success");
  });
  it("varig utstedelsesmarkør låser råvarelista selv uten mottakerbevis", () => {
    expect(canReplaceNegotiationItems("draft", [], "2026-10-12T05:49:00Z")).toBe(false);
    expect(canReplaceNegotiationItems("draft", [], null)).toBe(true);
  });
  it("retur til lista godtar bare trygg intern listesti", () => {
    expect(negotiationListReturn("/ravarer/leverandorer?fane=forhandlinger&q=test")).toBe("/ravarer/leverandorer?fane=forhandlinger&q=test");
    expect(negotiationListReturn("//evil.example")).toBe("/ravarer/leverandorer?fane=forhandlinger");
    expect(negotiationListReturn("/ravarer/annet")).toBe("/ravarer/leverandorer?fane=forhandlinger");
  });
});

describe("useUpsertNegotiationItems — kontekst og kvittering", () => {
  it("selskapsbytte midt i lesingen stopper før replace_child_rows", async () => {
    let release = () => undefined as void;
    st.statusRead = new Promise<void>((r) => { release = r; });
    const { result, rerender } = renderHook(() => useUpsertNegotiationItems(), { wrapper: wrap() });
    let p: Promise<unknown> = Promise.resolve();
    act(() => { p = result.current.mutateAsync({ negotiationId: "N", items: [{ raw_material_id: "m" }] }); });
    st.entity = "B";
    rerender();
    await act(async () => { release(); await expect(p).rejects.toBeInstanceOf(NegotiationContextChangedError); });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("tom kvittering er uklart utfall, ikke suksess", async () => {
    st.rpcData = null;
    const { result } = renderHook(() => useUpsertNegotiationItems(), { wrapper: wrap() });
    await act(async () => {
      await expect(result.current.mutateAsync({ negotiationId: "N", items: [{ raw_material_id: "m" }] })).rejects.toBeInstanceOf(NegotiationUncertainReceiptError);
    });
  });
});

const neg = { id: "n1", title: "Live", status: "awaiting_confirmation", live_confirmation_deadline: null } as NegotiationRow;
const items = [
  { id: "c1", raw_material_id: "m1", live_status: "confirmed", live_agreed_price: 10 },
  { id: "t1", raw_material_id: "m2", live_status: "tentatively_agreed", live_agreed_price: 11 },
] as NegotiationItemRow[];
const recipients = [{ id: "r1", supplier_id: "s1" }] as NegotiationRecipientRow[];
function renderStatus(qc = client()) {
  return render(<QueryClientProvider client={qc}><LiveConfirmationStatus neg={neg} items={items} recipients={recipients} rmName={() => "Mel"} supName={() => "Lev"} canWrite /></QueryClientProvider>);
}

describe("LiveConfirmationStatus — gjenoppretting", () => {
  it("ukjent utfall sperrer ny aktivering til status er lest og nytt forsøk eksplisitt tillatt", async () => {
    st.invoke.mockResolvedValue({ data: { success: true }, error: null }); // mangler applied → ukjent
    const qc = client();
    const refetch = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);
    renderStatus(qc);
    fireEvent.click(screen.getByRole("button", { name: /Aktiver alle uansett/ }));
    expect(await screen.findByText(/Utfallet er ukjent/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Aktiver alle uansett/ })).toBeNull();
    expect(screen.queryByText(/Status er lest på nytt/)).toBeNull();
    expect(screen.queryByRole("button", { name: /tillat nytt forsøk/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    fireEvent.click(await screen.findByRole("button", { name: /tillat nytt forsøk/ }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Aktiver alle uansett/ })).toBeTruthy();
    expect(st.invoke).toHaveBeenCalledTimes(1);
  });
  it("mislykket ny lesing gir ikke lov til nytt forsøk", async () => {
    st.invoke.mockResolvedValue({ data: null, error: { context: { status: 503 } } });
    const qc = client();
    vi.spyOn(qc, "refetchQueries").mockRejectedValue(new Error("net"));
    renderStatus(qc);
    fireEvent.click(screen.getByRole("button", { name: /Aktiver alle uansett/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByText(/kunne ikke leses på nytt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tillat nytt forsøk/ })).toBeNull();
  });
  it("feilet merking etter bekreftet aktivering gir bare statussteget for frosne linjer", async () => {
    st.invoke.mockResolvedValue({ data: { success: true, applied: 2 }, error: null });
    st.updateError = { message: "x" };
    renderStatus();
    fireEvent.click(screen.getByRole("button", { name: /Aktiver alle uansett/ }));
    expect(await screen.findByText(/Prisene sendes ikke på nytt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Aktiver alle uansett/ })).toBeNull();
    st.updateError = null;
    fireEvent.click(screen.getByRole("button", { name: /Merk bare gjenstående linjer/ }));
    await waitFor(() => expect(screen.queryByText(/Prisene sendes ikke på nytt/)).toBeNull());
    expect(st.invoke).toHaveBeenCalledTimes(1);
    const last = st.updates[st.updates.length - 1];
    expect(last.filters).toContainEqual(["id", ["t1"]]);
    expect(last.filters).toContainEqual(["negotiation_id", "n1"]);
  });
});
