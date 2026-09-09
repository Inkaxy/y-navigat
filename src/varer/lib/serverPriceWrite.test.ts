import { describe, it, expect } from "vitest";
import { parseSetPricesResult, toSetPricesPayload, summarizeSetPrices } from "./serverPriceWrite";

describe("toSetPricesPayload", () => {
  it("tar med dato og notat bare når de er satt", () => {
    expect(
      toSetPricesPayload([
        { priceListId: "pl", productId: "p", price: 10 },
        { priceListId: "pl", productId: "q", price: 12, validFrom: "2026-09-10", note: "runde" },
      ]),
    ).toEqual([
      { price_list_id: "pl", product_id: "p", price: 10 },
      { price_list_id: "pl", product_id: "q", price: 12, valid_from: "2026-09-10", note: "runde" },
    ]);
  });

  it("avviser ugyldig pris før den sendes", () => {
    expect(() => toSetPricesPayload([{ priceListId: "pl", productId: "p", price: -1, label: "Kneipp" }])).toThrow(
      /Kneipp/,
    );
  });
});

describe("parseSetPricesResult", () => {
  it("leser tellere og rader, også når tallene kommer som tekst", () => {
    const res = parseSetPricesResult({
      ok: false,
      total: "3",
      succeeded: 1,
      unchanged: 1,
      failed: 1,
      results: [
        { index: 0, ok: true, product_id: "a", price_list_id: "pl", unchanged: false, old_price: "10.00", price: "11.00" },
        { index: 1, ok: true, product_id: "b", price_list_id: "pl", unchanged: true },
        { index: 2, ok: false, product_id: "c", price_list_id: "pl", error: "Prislisten er ikke aktiv" },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.total).toBe(3);
    expect(res.succeeded).toBe(1);
    expect(res.unchanged).toBe(1);
    expect(res.rows[0].oldPrice).toBe(10);
    expect(res.rows[1].unchanged).toBe(true);
    expect(res.rows[2].error).toBe("Prislisten er ikke aktiv");
  });

  it("tåler tomt eller ukjent svar", () => {
    const res = parseSetPricesResult(null);
    expect(res).toEqual({ ok: false, total: 0, succeeded: 0, unchanged: 0, failed: 0, rows: [] });
  });
});

describe("summarizeSetPrices", () => {
  it("oppsummerer på norsk med navn på første feil", () => {
    const res = parseSetPricesResult({
      ok: false,
      total: 2,
      succeeded: 1,
      unchanged: 0,
      failed: 1,
      results: [
        { index: 0, ok: true, product_id: "a" },
        { index: 1, ok: false, product_id: "b", error: "Ingen skrivetilgang til priser" },
      ],
    });
    expect(summarizeSetPrices(res, (id) => (id === "b" ? "Grovbrød" : "?"))).toBe(
      "1 pris lagret, 1 feilet (Grovbrød: Ingen skrivetilgang til priser)",
    );
  });

  it("sier fra når ingenting endret seg", () => {
    expect(summarizeSetPrices(parseSetPricesResult({ ok: true, total: 0, results: [] }))).toBe("Ingen endringer");
  });
});
