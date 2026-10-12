import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Call = { table: string; kind: string; signal?: AbortSignal };
const calls: Call[] = [];
let invoiceGate: Promise<void> | null = null;
let lines: { id: string; updated_at: string; raw_material_id: string }[] = [];
const SERVER_CAP = 1000;
let page2Error = false;

function builder(table: string) {
  const st: { head?: boolean; gt?: string; limit?: number; signal?: AbortSignal; single?: boolean } = {};
  const b = {
    select: (_c: string, o?: { head?: boolean }) => { st.head = !!o?.head; return b; },
    eq: () => b, order: () => b,
    gt: (_k: string, v: string) => { st.gt = v; return b; },
    limit: (n: number) => { st.limit = n; return b; },
    abortSignal: (s: AbortSignal) => { st.signal = s; return b; },
    maybeSingle: () => { st.single = true; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  async function run(): Promise<unknown> {
    if (st.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (table === "invoices") {
      calls.push({ table, kind: "invoice", signal: st.signal });
      if (invoiceGate) await invoiceGate;
      return { data: { id: "x", legal_entity_id: "e1" }, error: null };
    }
    if (st.head) { calls.push({ table, kind: "count" }); return { count: lines.length, error: null }; }
    calls.push({ table, kind: "page" });
    if (page2Error && st.gt) return { data: null, error: { message: "boom" } };
    const sorted = [...lines].sort((a, b) => a.id.localeCompare(b.id)).filter((l) => !st.gt || l.id > st.gt);
    return { data: sorted.slice(0, Math.min(st.limit ?? 1e9, SERVER_CAP)), error: null };
  }
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (_n: string, a: { p_invoice_id: string }) => {
      const r = {
        abortSignal: () => r,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: safetyPayload(a.p_invoice_id), error: null }).then(res),
      };
      return r;
    },
  },
}));

function safetyPayload(inv: string) {
  return { schema_version: 2, invoice_id: inv, legal_entity_id: "e1", checked_at: new Date().toISOString(), lines: [] };
}

import { fetchInvoicePriceSafety, useInvoicePriceSafety, __safetyQueueState } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { versionKey } from "@/fakturaer/lib/priceSafety";

beforeEach(() => { calls.length = 0; invoiceGate = null; lines = []; page2Error = false; cleanup(); });

describe("versionKey streng kalender/tid/sone", () => {
  it.each(["2026-02-30T00:00:00Z", "2026-10-11T24:00:00Z", "2026-10-11T00:60:00Z", "2026-10-11T00:00:00+01:60",
    "2026-00-10T00:00:00Z", "2026-13-10T00:00:00Z", "2026-10-00T00:00:00Z", "2026-04-31T00:00:00Z", "2025-02-29T00:00:00Z",
    "2026-10-11T00:00:60Z", "2026-10-11T00:00:00+16:00", "2026-10-11T00:00:00", "2026-10-11T00:00:00.1234567Z"])("avviser %s", (v) => {
    expect(versionKey(v)).toBeNull();
  });
  it("godtar skuddår, mikrosekunder og ekvivalent sone", () => {
    expect(versionKey("2024-02-29T00:00:00Z")).not.toBeNull();
    expect(versionKey("2026-10-11T12:00:00.682988+02:00")).toBe(versionKey("2026-10-11T10:00:00.682988Z"));
    expect(versionKey("2026-10-11T10:00:00.682988Z")).not.toBe(versionKey("2026-10-11T10:00:00.682989Z"));
  });
  it("år 00–99 tolkes ikke som 1900-tallet", () => {
    expect(versionKey("0050-01-01T00:00:00Z")).not.toBe(versionKey("1950-01-01T00:00:00Z"));
  });
});

describe("fetchInvoicePriceSafety: kø og avbrudd", () => {
  it("20 jobber bak fire blokkerte: avbrutte 16 starter aldri, køen tømmes", async () => {
    let release!: () => void;
    invoiceGate = new Promise((r) => { release = r; });
    const ctrls = Array.from({ length: 20 }, () => new AbortController());
    const ps = ctrls.map((c, i) => fetchInvoicePriceSafety(`inv-${i}`, c.signal).then(() => "ok", (e: Error) => e.name));
    await Promise.resolve();
    expect(__safetyQueueState()).toEqual({ active: 4, waiting: 16 });
    ctrls.slice(4).forEach((c) => c.abort());
    expect(__safetyQueueState().waiting).toBe(0);
    release();
    const out = await Promise.all(ps);
    expect(out.slice(0, 4)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(out.slice(4).every((x) => x === "AbortError")).toBe(true);
    expect(calls.filter((c) => c.kind === "invoice")).toHaveLength(4);
    expect(__safetyQueueState()).toEqual({ active: 0, waiting: 0 });
    invoiceGate = null;
    await expect(fetchInvoicePriceSafety("etter")).resolves.toBeTruthy();
  });
  it("forhåndsavbrutt: ingen forespørsel", async () => {
    const c = new AbortController(); c.abort();
    await expect(fetchInvoicePriceSafety("a", c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });
  it("fakturaoppslaget får signalet", async () => {
    const c = new AbortController();
    await fetchInvoicePriceSafety("a", c.signal);
    expect(calls[0].signal).toBe(c.signal);
  });
});

describe("komplette radversjoner", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${String(i).padStart(5, "0")}`, updated_at: "2026-10-11T10:00:00Z", raw_material_id: "rm" }));
  it("2501 linjer med servertak 1000: alle rader med, siste inkludert", async () => {
    lines = mk(2501);
    const r = await fetchInvoicePriceSafety("a");
    expect(r.rows.size).toBe(2501);
    expect(r.rows.has("l02500")).toBe(true);
  });
  it("tom faktura gir tomt kart", async () => {
    const r = await fetchInvoicePriceSafety("a");
    expect(r.rows.size).toBe(0);
  });
  it("feil på side to publiserer ikke delvis kart", async () => {
    lines = mk(1200); page2Error = true;
    await expect(fetchInvoicePriceSafety("a")).rejects.toBeTruthy();
  });
});

describe("hook-livssyklus med ekte QueryClient", () => {
  function Obs({ active }: { active: boolean }) {
    const s = useInvoicePriceSafety(["inv-shared"], { active });
    return <span data-testid="o">{String(s.loading)}</span>;
  }
  it("inaktiv observatør henter ikke; synlig observatør av samme nøkkel fortsetter", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const qc = new QueryClient();
    const W = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const hidden = render(<W><Obs active={false} /></W>);
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(calls.filter((c) => c.kind === "invoice")).toHaveLength(0);
    render(<W><Obs active={true} /></W>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(calls.filter((c) => c.kind === "invoice")).toHaveLength(1);
    hidden.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(calls.filter((c) => c.kind === "invoice").length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});
