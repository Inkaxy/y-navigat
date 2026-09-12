/**
 * @vitest-environment jsdom
 *
 * Regresjonstester for Excel-flyten (SheetJS 0.20.x): eksport fra Rapporter og
 * import av Tedebe-fil. Dekker norske tegn, desimaltall, datoer og tomme felt.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import { buildXlsxWorkbook, FMT_NOK, FMT_QTY } from "@/rapporter/lib/xlsxExport";
import { parseXlsxFile } from "@/varer/lib/tedebeImport";

function sheetOf(wb: XLSX.WorkBook): XLSX.WorkSheet {
  return wb.Sheets[wb.SheetNames[0]];
}

function roundtrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return XLSX.read(buf, { type: "array" });
}

describe("xlsx-eksport", () => {
  const columns = [
    { header: "Vare" },
    { header: "Antall", format: FMT_QTY },
    { header: "Beløp", format: FMT_NOK },
    { header: "Dato" },
  ];
  const rows = [
    ["Grovbrød à 750 g", 12, 1234.56, "2026-09-12"],
    ["Rundstykke «kneipp»", 0, 0, "2026-09-13"],
    ["Wienerbrød, æøå", null, null, ""],
  ];

  it("skriver tall som tall og tekst som tekst, med norske tegn intakt", () => {
    const ws = sheetOf(roundtrip(buildXlsxWorkbook("Rapport", columns, rows)));
    expect(ws["A2"].v).toBe("Grovbrød à 750 g");
    expect(ws["A3"].v).toBe("Rundstykke «kneipp»");
    expect(ws["A4"].v).toBe("Wienerbrød, æøå");
    expect(ws["B2"].t).toBe("n");
    expect(ws["B2"].v).toBe(12);
    expect(ws["C2"].t).toBe("n");
    expect(ws["C2"].v).toBeCloseTo(1234.56, 2);
  });

  it("bevarer ekte 0 som tall (ikke tomt)", () => {
    const ws = sheetOf(roundtrip(buildXlsxWorkbook("Rapport", columns, rows)));
    expect(ws["B3"].t).toBe("n");
    expect(ws["B3"].v).toBe(0);
    expect(ws["C3"].v).toBe(0);
  });

  it("lar tomme felt være tomme, ikke 0", () => {
    const ws = sheetOf(roundtrip(buildXlsxWorkbook("Rapport", columns, rows)));
    expect(ws["B4"]).toBeUndefined();
    expect(ws["C4"]).toBeUndefined();
    expect(ws["D4"]?.v ?? "").toBe("");
  });

  it("setter norsk tallformat på beløp og bevarer datotekst", () => {
    const built = sheetOf(buildXlsxWorkbook("Rapport", columns, rows));
    expect(built["C2"].z).toBe(FMT_NOK);
    expect(built["B2"].z).toBe(FMT_QTY);
    // Tekstceller får aldri tallformat.
    expect(built["A2"].z).toBeUndefined();
    const ws = sheetOf(roundtrip(buildXlsxWorkbook("Rapport", columns, rows)));
    expect(ws["D2"].v).toBe("2026-09-12");
  });

  it("kutter arknavn til Excels grense på 31 tegn", () => {
    const wb = buildXlsxWorkbook("Et altfor langt arknavn som Excel ikke tåler", columns, []);
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
  });

  it("skriver header selv uten rader", () => {
    const ws = sheetOf(roundtrip(buildXlsxWorkbook("Tom", columns, [])));
    expect(ws["A1"].v).toBe("Vare");
    expect(ws["D1"].v).toBe("Dato");
  });
});

function xlsxFile(aoa: unknown[][], name = "tedebe.xlsx"): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Ark1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  // jsdom sin File mangler arrayBuffer(); parseren trenger bare navn + buffer.
  return { name, arrayBuffer: async () => buf } as unknown as File;
}

const HEADER = [
  "Varenummer",
  "Varenavn",
  "Utsalgspris eks mva",
  "Engrospris eks mva",
  "Momskode",
];

describe("Tedebe-import fra Excel", () => {
  it("leser norske navn, desimaler og momskoder", async () => {
    const res = await parseXlsxFile(
      xlsxFile([
        HEADER,
        [1001, "Grovbrød å 750g", 39.9, 28.5, "H"],
        [1002, "Kaffe æøå", "49,50", "35,00", "P"],
      ]),
    );
    expect(res.parse_errors).toEqual([]);
    expect(res.missing_columns).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].varenavn).toBe("Grovbrød å 750g");
    expect(res.rows[0].utsalgspris).toBeCloseTo(39.9, 2);
    expect(res.rows[1].utsalgspris).toBeCloseTo(49.5, 2);
    expect(res.rows[1].engrospris).toBeCloseTo(35, 2);
    expect(res.rows[1].momskode).toBe("P");
  });

  it("tolker tomme felt og 0 engrospris som «ikke satt», og varsler på rader", async () => {
    const res = await parseXlsxFile(
      xlsxFile([
        HEADER,
        [1003, "Uten priser", "", 0, ""],
        ["", "", "", "", ""],
        ["", "Uten varenummer", 10, 5, "H"],
      ]),
    );
    expect(res.rows).toHaveLength(2); // helt tom rad hoppes over
    expect(res.rows[0].utsalgspris).toBeNull();
    expect(res.rows[0].engrospris).toBeNull();
    expect(res.rows[0].momskode).toBeNull();
    expect(res.rows[1].warnings).toContain("Ugyldig varenummer");
  });

  it("melder tydelig fra om manglende kolonner uten å importere noe", async () => {
    const res = await parseXlsxFile(xlsxFile([["Varenummer", "Varenavn"], [1, "Brød"]]));
    expect(res.rows).toHaveLength(0);
    expect(res.missing_columns).toContain("momskode");
  });

  it("varsler om ukjent momskode i stedet for å forkaste raden", async () => {
    const res = await parseXlsxFile(xlsxFile([HEADER, [1004, "Rar mva", 10, 5, "X"]]));
    expect(res.rows[0].momskode).toBe("H");
    expect(res.rows[0].warnings.join(" ")).toMatch(/ukjent momskode/i);
  });
});
