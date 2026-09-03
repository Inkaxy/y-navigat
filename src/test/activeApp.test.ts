import { describe, expect, it } from "vitest";
import {
  APP_ROUTE_PREFIXES,
  DEFAULT_APP_CODE,
  resolveAppCodeFromPath,
} from "@/lib/activeApp";

describe("resolveAppCodeFromPath", () => {
  it("faller tilbake til nbhub for plattformsider", () => {
    expect(resolveAppCodeFromPath("/")).toBe(DEFAULT_APP_CODE);
    expect(resolveAppCodeFromPath("/hjem")).toBe(DEFAULT_APP_CODE);
    expect(resolveAppCodeFromPath("/min-profil")).toBe(DEFAULT_APP_CODE);
    expect(resolveAppCodeFromPath("/ukjent/rute")).toBe(DEFAULT_APP_CODE);
  });

  it("kjenner igjen app-rotruter", () => {
    expect(resolveAppCodeFromPath("/ordre")).toBe("ordre");
    expect(resolveAppCodeFromPath("/varer")).toBe("varer");
    expect(resolveAppCodeFromPath("/kunder")).toBe("kunder");
    expect(resolveAppCodeFromPath("/ravarer")).toBe("ravarer");
    expect(resolveAppCodeFromPath("/produksjon")).toBe("produksjon");
    expect(resolveAppCodeFromPath("/admin")).toBe("nbos");
  });

  it("kjenner igjen underruter", () => {
    expect(resolveAppCodeFromPath("/ordre/ticket/42")).toBe("ordre");
    expect(resolveAppCodeFromPath("/ravarer/vareliste")).toBe("ravarer");
    expect(resolveAppCodeFromPath("/kunder/portaltilgang")).toBe("kunder");
    expect(resolveAppCodeFromPath("/pos-styring/utsalg")).toBe("pos_styring");
    expect(resolveAppCodeFromPath("/rapporter/dashbord")).toBe("rapporter");
    expect(resolveAppCodeFromPath("/fakturering/kjoringer")).toBe("faktura");
  });

  it("matcher ikke på delvis segment", () => {
    expect(resolveAppCodeFromPath("/ordrebekreftelse")).toBe(DEFAULT_APP_CODE);
    expect(resolveAppCodeFromPath("/varerapport")).toBe(DEFAULT_APP_CODE);
  });

  it("tåler query, hash og etterfølgende skråstrek", () => {
    expect(resolveAppCodeFromPath("/ordre/")).toBe("ordre");
    expect(resolveAppCodeFromPath("/varer?tab=merking")).toBe("varer");
    expect(resolveAppCodeFromPath("/produksjon/plan#i-dag")).toBe("produksjon");
  });

  it("velger lengste prefiks først, uavhengig av rekkefølge i tabellen", () => {
    const table = [
      { prefix: "/kunder", code: "kunder" },
      { prefix: "/kunder/portaltilgang", code: "kundeportal_admin" },
    ];
    expect(resolveAppCodeFromPath("/kunder/portaltilgang/ny", table)).toBe("kundeportal_admin");
    expect(resolveAppCodeFromPath("/kunder/1234", table)).toBe("kunder");
  });

  it("har unike prefikser i registeret", () => {
    const prefixes = APP_ROUTE_PREFIXES.map((entry) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
