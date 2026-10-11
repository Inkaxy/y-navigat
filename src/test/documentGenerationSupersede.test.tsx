// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Ekte hook (`useInvoiceDocumentVersion`) med to delte konsumenter i samme QueryClient.
// Bare nettverk (rpc) og innlogget bruker er stubbet; hvert rpc-kall styres med en utsatt promise.
type RpcResult = { data: unknown; error: unknown };
type Deferred = { resolve: (r: RpcResult) => void; promise: Promise<RpcResult> };
const calls: Deferred[] = [];
const defer = (): Deferred => { let resolve!: (r: RpcResult) => void; const promise = new Promise<RpcResult>((r) => { resolve = r; }); return { resolve, promise }; };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => { const d = defer(); calls.push(d); return Object.assign(d.promise, { abortSignal: () => d.promise }); } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuthUserId: () => "u1" }));

import { useInvoiceDocumentVersion } from "@/fakturaer/hooks/useInvoiceDocumentVersion";

const PATH = "c1/doc.pdf";
const meta = (version: string): RpcResult => ({ data: { available: true, invoice_id: "i1", path: PATH, object_id: "o1", version, storage_version: "v1", updated_at: null }, error: null });
const fail = (): RpcResult => ({ data: null, error: new Error("nett") });
const ident = (v: string) => `${PATH}|${v}`;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["company"], { id: "c1" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ a: useInvoiceDocumentVersion("i1"), b: useInvoiceDocumentVersion("i1") }), { wrapper });
  return result;
}
/** Besvar alle ventende metadataoppslag (delt query) med `r`. */
async function answerPending(from: number, r: RpcResult) {
  await act(async () => { for (const d of calls.slice(from)) d.resolve(r); await Promise.resolve(); });
}

beforeEach(() => { calls.length = 0; });

describe("delt verifiseringsgenerasjon — utdaterte kontroller", () => {
  it.each([
    ["feil", fail()],
    ["avvik", meta("v-annen")],
  ])("gammel kontroll med %s etter vellykket eksplisitt oppdatering tilbakekaller ikke ny verifisering", async (_n, late) => {
    const r = setup();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await answerPending(0, meta("v1"));
    await waitFor(() => expect(r.current.a.verifiedCurrent).not.toBeNull());
    const g1 = r.current.a.generation;

    // Gammel kontroll startes i generasjon g1 og henger.
    let old: Promise<string | null> = Promise.resolve(null);
    act(() => { old = r.current.a.recheck(ident("v1"), g1).catch(() => "kastet"); });
    const oldIdx = calls.length - 1;

    // Eksplisitt oppdatering: ny generasjon; ingen konsument ser gammel cache som verifisert.
    const before = calls.length;
    act(() => { r.current.b.refresh(); });
    expect(r.current.a.verifiedCurrent).toBeNull();
    expect(r.current.b.verifiedCurrent).toBeNull();
    expect(r.current.a.generation).toBe(g1 + 1);
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    await answerPending(before, meta("v1"));
    await waitFor(() => expect(r.current.a.verifiedCurrent).not.toBeNull());
    expect(r.current.b.verifiedCurrent).not.toBeNull();

    // Sen gammel fullføring: ignoreres (ingen tilbakekalling, ingen kast).
    await act(async () => { calls[oldIdx].resolve(late); await old; });
    expect(await old).toBeNull();
    expect(r.current.a.revoked).toBe(false);
    expect(r.current.a.verifiedCurrent).not.toBeNull();
    expect(r.current.b.verifiedCurrent).not.toBeNull();
  });

  it("gammel samsvarende kontroll sertifiserer ikke bytes for utdatert generasjon", async () => {
    const r = setup();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await answerPending(0, meta("v1"));
    await waitFor(() => expect(r.current.a.verifiedCurrent).not.toBeNull());
    const g1 = r.current.a.generation;
    let old: Promise<string | null> = Promise.resolve(null);
    act(() => { old = r.current.a.recheck(ident("v1"), g1); });
    const oldIdx = calls.length - 1;
    act(() => { r.current.a.refresh(); });
    await act(async () => { calls[oldIdx].resolve(meta("v1")); await old; });
    expect(await old).toBeNull();
    // Kontroll i utdatert generasjon starter ikke engang et oppslag.
    const n = calls.length;
    expect(await r.current.a.recheck(ident("v1"), g1)).toBeNull();
    expect(calls.length).toBe(n);
  });

  it("feil i gjeldende generasjon tilbakekaller straks for alle konsumenter, uten løkke", async () => {
    const r = setup();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await answerPending(0, meta("v1"));
    await waitFor(() => expect(r.current.b.verifiedCurrent).not.toBeNull());
    let p: Promise<string | null> = Promise.resolve(null);
    act(() => { p = r.current.a.recheck(ident("v1")).catch(() => "kastet"); });
    await act(async () => { calls[calls.length - 1].resolve(fail()); await p; });
    expect(await p).toBe("kastet");
    await waitFor(() => expect(r.current.a.revoked).toBe(true));
    expect(r.current.b.verifiedCurrent).toBeNull();
    const n = calls.length;
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    expect(calls.length).toBe(n);
    // Eksplisitt retry gjenoppretter først etter ferskt oppslag i ny generasjon.
    act(() => { r.current.b.refresh(); });
    expect(r.current.a.verifiedCurrent).toBeNull();
    await waitFor(() => expect(calls.length).toBeGreaterThan(n));
    await answerPending(n, meta("v1"));
    await waitFor(() => expect(r.current.a.verifiedCurrent).not.toBeNull());
  });
});
