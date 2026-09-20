import { describe, it, expect } from "vitest";
import { fetchPagesUpTo } from "@/lib/supabasePaging";

function pagedSource(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const query = async (from: number, to: number) => {
    calls.push([from, to]);
    const size = Math.min(to - from + 1, cap);
    return { data: rows.slice(from, from + size), error: null };
  };
  return { query, calls };
}

describe("fetchPagesUpTo", () => {
  it("henter forbi API-taket på 1000 rader", async () => {
    const { query, calls } = pagedSource(2500);
    const got = await fetchPagesUpTo(query, 2001);
    expect(got).toHaveLength(2001);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("stopper når kilden har færre rader enn ønsket", async () => {
    const { query } = pagedSource(120);
    expect(await fetchPagesUpTo(query, 5001)).toHaveLength(120);
  });

  it("returnerer aldri flere rader enn ønsket", async () => {
    const { query } = pagedSource(5000);
    expect(await fetchPagesUpTo(query, 10)).toHaveLength(10);
  });

  it("kaster ved lesefeil i stedet for å melde tom liste", async () => {
    await expect(
      fetchPagesUpTo(async () => ({ data: null, error: { message: "nede" } }), 50),
    ).rejects.toThrow("nede");
  });
});
