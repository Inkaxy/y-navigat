import { describe, expect, it, vi } from "vitest";
import { createGate, isTransientDbError, TRANSIENT_RETRY } from "./heavyGate";

const deferred = <T,>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("workGate – høyst ett tungt kall om gangen", () => {
  it("slipper bare ett kall gjennom; neste starter først når det første er ferdig", async () => {
    const g = createGate(1, 0);
    const a = deferred<string>(); const b = deferred<string>();
    const started: string[] = [];
    const ra = g.run(() => { started.push("a"); return a.p; });
    const rb = g.run(() => { started.push("b"); return b.p; });
    await flush();
    expect(started).toEqual(["a"]);
    a.resolve("A"); await expect(ra).resolves.toBe("A"); await flush();
    expect(started).toEqual(["a", "b"]);
    b.resolve("B"); await expect(rb).resolves.toBe("B");
  });

  it("lister går foran tellere i køen", async () => {
    vi.useFakeTimers();
    const g = createGate(1, 600);
    const first = deferred<void>();
    const order: string[] = [];
    void g.run(() => { order.push("første"); return first.p; });
    void g.run(async () => { order.push("teller"); }, { low: true });
    vi.advanceTimersByTime(600);
    void g.run(async () => { order.push("liste"); });
    first.resolve();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(order).toEqual(["første", "liste", "teller"]);
  });

  it("et kall som venter i køen fjernes ved avbrudd og sendes aldri", async () => {
    const g = createGate(1, 0);
    const a = deferred<void>();
    const fn = vi.fn(async () => "x");
    void g.run(() => a.p);
    const ac = new AbortController();
    const r = g.run(fn, { signal: ac.signal });
    ac.abort();
    await expect(r).rejects.toMatchObject({ name: "AbortError" });
    a.resolve(); await flush(); await flush();
    expect(fn).not.toHaveBeenCalled();
    expect(g.active).toBe(0);
  });

  it("et sendt kall holder porten til svaret er kommet, selv om det avbrytes", async () => {
    const g = createGate(1, 0);
    const a = deferred<void>();
    const ac = new AbortController();
    void g.run(() => a.p, { signal: ac.signal });
    ac.abort();
    await flush();
    expect(g.active).toBe(1);
    a.resolve(); await flush(); await flush();
    expect(g.active).toBe(0);
  });

  it("en feil frigjør porten for neste kall", async () => {
    const g = createGate(1, 0);
    await expect(g.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(g.run(async () => 1)).resolves.toBe(1);
  });
});

describe("ett nytt forsøk bare ved forbigående feil", () => {
  it("tidsavbrudd i databasen prøves én gang til", () => {
    const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(isTransientDbError(timeout)).toBe(true);
    expect(TRANSIENT_RETRY.retry(0, timeout)).toBe(true);
    expect(TRANSIENT_RETRY.retry(1, timeout)).toBe(false);
  });
  it("nettverksbrudd prøves på nytt", () => {
    expect(isTransientDbError(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("tilgangsfeil og ukjent gruppe prøves ikke på nytt", () => {
    expect(isTransientDbError({ code: "42501", message: "Ingen fakturatilgang" })).toBe(false);
    expect(isTransientDbError({ code: "22023", message: "Ukjent gruppe: x" })).toBe(false);
  });
});
