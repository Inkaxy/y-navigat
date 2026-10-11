import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimeline, historyKind, timelineCsv, type TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import { documentedPriceError, documentedPriceMessage, isIncompleteCost, parseCostPriceSource, parseDocumentedPrice } from "@/ravarer/lib/costPriceSource";
import { rawMaterialQueryKeys } from "@/ravarer/lib/invalidate";

const row = (p: Partial<TimelineHistoryRow> & { id: string; effective_date: string; price: number }): TimelineHistoryRow => ({
  supplier_id: "sa", source: "invoice", invoice_id: null, ...p,
});
const names = new Map([["sa", "Leverandør A"], ["sb", "Leverandør B"]]);

describe("historikkrader: bare gyldige punkter er priser", () => {
  it("klassifiserer utgått, eldre, kreditnota, valuta og ugyldig", () => {
    expect(historyKind(row({ id: "1", effective_date: "2026-01-01", price: 10 }))).toBe("gyldig");
    expect(historyKind(row({ id: "2", effective_date: "2026-01-01", price: 10, supersededAt: "2026-02-01T00:00:00Z", supersededReason: "linje_ukoblet" }))).toBe("utgatt");
    expect(historyKind(row({ id: "3", effective_date: "2026-01-01", price: 10, isLegacy: true }))).toBe("eldre");
    expect(historyKind(row({ id: "4", effective_date: "2026-01-01", price: 10, isCredit: true }))).toBe("kreditnota");
    expect(historyKind(row({ id: "5", effective_date: "2026-01-01", price: 10, isCreditNote: true }))).toBe("kreditnota");
    expect(historyKind(row({ id: "6", effective_date: "2026-01-01", price: 10, currency: "EUR" }))).toBe("annen_valuta");
    expect(historyKind(row({ id: "7", effective_date: "2026-01-01", price: 0 }))).toBe("ugyldig");
  });

  it("graf og Δ bruker bare sammenlignbare gyldige punkter; korrigerte/legacy er egne hendelser", () => {
    const r = buildTimeline({
      history: [
        row({ id: "a", effective_date: "2026-01-01", price: 10 }),
        row({ id: "b", effective_date: "2026-02-01", price: 99, isLegacy: true }),
        row({ id: "c", effective_date: "2026-03-01", price: 1, supersededAt: "2026-03-05T00:00:00Z", supersededReason: "til_gjennomgang" }),
        row({ id: "d", effective_date: "2026-04-01", price: -13, isCredit: true }),
        row({ id: "e", effective_date: "2026-05-01", price: 13 }),
      ],
      supplierNames: names, links: [],
    });
    expect(r.rows.map((p) => p.id)).toEqual(["e", "a"]);
    const e = r.rows[0];
    expect(e.deltaPrevKr).toBe(3);
    expect(e.deltaPrevPct).toBeCloseTo(30, 6); // reell 30 % økning er et ordinært punkt
    expect(r.events.map((x) => x.kind).sort()).toEqual(["eldre", "kreditnota", "utgatt"]);
    expect(r.events.find((x) => x.id === "c")?.reason).toBe("Linjen ble sendt til gjennomgang");
  });

  it("CSV følger samme regler: gyldige rader med Δ kr/%, deretter hendelser med type og årsak", () => {
    const r = buildTimeline({
      history: [row({ id: "a", effective_date: "2026-01-01", price: 10 }), row({ id: "b", effective_date: "2026-02-01", price: 12 }),
        row({ id: "x", effective_date: "2026-01-15", price: 50, supersededReason: "enhet_endret", supersededAt: "2026-02-01T00:00:00Z" })],
      supplierNames: names, links: [],
    });
    const csv = timelineCsv(r.rows, r.events).split("\n");
    expect(csv[0]).toContain("Type;Dato");
    expect(csv[1]).toMatch(/^Gyldig;2026-02-01;Leverandør A;12\.0000;invoice;;2\.0000;20\.0;/);
    expect(csv[3]).toMatch(/^Utgått \/ korrigert;2026-01-15;.*Grunnenheten ble endret/);
  });

  it("samme dato: stabil rekkefølge (id) så Δ ikke hopper", () => {
    const h = [row({ id: "b", effective_date: "2026-01-01", price: 12 }), row({ id: "a", effective_date: "2026-01-01", price: 10 })];
    const r1 = buildTimeline({ history: h, supplierNames: names, links: [] });
    const r2 = buildTimeline({ history: [...h].reverse(), supplierNames: names, links: [] });
    expect(r1.series[0].points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r2.series[0].points.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("pris per pakning (5/10 kg) via enhetsvalg endrer ikke hvilke punkter som teller", () => {
    const r = buildTimeline({ history: [row({ id: "a", effective_date: "2026-01-01", price: 18 }), row({ id: "b", effective_date: "2026-02-01", price: 20 })], supplierNames: names, links: [], unitFactor: 10 });
    expect(r.rows.map((p) => p.price)).toEqual([200, 180]);
  });

  it("1000+ rader: alle tas med (ingen avkutting i visningslogikken)", () => {
    const h: TimelineHistoryRow[] = [];
    for (let i = 0; i < 1500; i++) {
      const d = `${2020 + Math.floor(i / 365)}-${String(1 + Math.floor((i % 365) / 31) % 12).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
      h.push(row({ id: `r${String(i).padStart(4, "0")}`, effective_date: d, price: 10 + (i % 7), supplier_id: i % 2 ? "sa" : "sb", isLegacy: i % 10 === 0 }));
    }
    const r = buildTimeline({ history: h, supplierNames: names, links: [] });
    expect(r.rows.length).toBe(1350);
    expect(r.events.length).toBe(150);
  });

  it("usePriceHistory henter alle sider og inkluderer felt for klassifisering", () => {
    const src = readFileSync("src/ravarer/hooks/useRmSuppliers.ts", "utf8");
    expect(src).toMatch(/fetchAllRows<HistoryDbRow>/);
    expect(src).toMatch(/superseded_at, superseded_reason, is_legacy, is_credit, currency/);
  });
});

describe("manuell dokumentert pris går via én atomisk RPC", () => {
  it("ingen separat historikk-INSERT og råvare-UPDATE i klienten", () => {
    const src = readFileSync("src/ravarer/hooks/useRmSuppliers.ts", "utf8");
    const add = src.slice(src.indexOf("export function useAddPriceHistory"));
    expect(add).toContain('rpc("rm_set_documented_cost_price"');
    expect(add).not.toContain('from("raw_material_price_history").insert');
    expect(add).not.toContain('from("raw_materials")');
  });
  it("svar og meldinger", () => {
    expect(documentedPriceMessage(parseDocumentedPrice({ ok: true, future: true, is_current: false }))).toMatch(/på datoen/);
    expect(documentedPriceMessage(parseDocumentedPrice({ ok: true, future: false, is_current: true }))).toMatch(/nå gjeldende/);
    expect(documentedPriceMessage(parseDocumentedPrice({ ok: true, future: false, is_current: false }))).toMatch(/nyere gyldig pris gjelder/);
    expect(documentedPriceError("ugyldig_pris: x")).toBe("Prisen må være større enn 0");
    expect(documentedPriceError("forbidden: x")).toMatch(/skrivetilgang/);
    expect(documentedPriceError("relation x")).toBe("Prisen ble ikke lagret. Prøv igjen.");
  });
});

describe("gjeldende kilde", () => {
  it("leser kilde med faktura, leverandør, dato og planlagt pris", () => {
    const s = parseCostPriceSource({ status: "ok", current_price: 13, base_unit: "kg",
      source: { history_id: "h1", price: 13, effective_date: "2026-10-01", source: "invoice", supplier_id: "sb", supplier_name: "B", invoice_id: "i2", invoice_line_id: "l2", invoice_number: "ZZ2" },
      next: { price: 20, effective_date: "2026-10-16", source: "manual" } });
    expect(s.status).toBe("ok");
    expect(s.source?.invoiceNumber).toBe("ZZ2");
    expect(s.next?.price).toBe(20);
  });
  it("ingen kilde er uverifisert/mangler — aldri null-kost", () => {
    const s = parseCostPriceSource({ status: "uverifisert", current_price: 50, base_unit: "kg", source: null, next: null });
    expect(s.status).toBe("uverifisert");
    expect(s.currentPrice).toBe(50);
    expect(isIncompleteCost("uverifisert")).toBe(true);
    expect(isIncompleteCost("mangler")).toBe(true);
    expect(isIncompleteCost("ok")).toBe(false);
  });
});

describe("invalidering etter prisendring", () => {
  it("treffer kalkylene og kilden", () => {
    const keys = rawMaterialQueryKeys("rm1").map((k) => k[0]);
    for (const k of ["product-cost", "product-margins", "product-margin-rows", "recipe-detail", "rm-cost-source", "rm-cost-deviations"]) expect(keys).toContain(k);
  });
});
