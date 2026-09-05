import { describe, expect, it } from "vitest";
import { evaluatePrintGate, type PrintGateInput } from "@/ordre/lib/cakePrintGate";
import { pickPrinterLabel } from "@/ordre/hooks/useCakeCalibration";

const base: PrintGateInput = {
  format_id: "f1",
  width_mm: 150,
  height_mm: 150,
  quality_flag: "god",
  quality_ack_at: null,
  rights_cleared: true,
  rights_note: null,
};

describe("evaluatePrintGate", () => {
  it("slipper gjennom bilde med format, god kvalitet og avklarte rettigheter", () => {
    expect(evaluatePrintGate(base)).toEqual({ ok: true });
  });

  it("stopper bilde uten format", () => {
    const res = evaluatePrintGate({
      ...base,
      format_id: null,
      width_mm: null,
      height_mm: null,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("format");
  });

  it("godtar format satt med bare mål", () => {
    expect(evaluatePrintGate({ ...base, format_id: null })).toEqual({ ok: true });
  });

  it("stopper lav oppløsning som ikke er bekreftet", () => {
    const res = evaluatePrintGate({ ...base, quality_flag: "lav" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("Lav oppløsning");
  });

  it("slipper gjennom lav oppløsning når den er bekreftet", () => {
    expect(
      evaluatePrintGate({
        ...base,
        quality_flag: "lav",
        quality_ack_at: "2026-01-01T10:00:00Z",
      }),
    ).toEqual({ ok: true });
  });

  it("stopper uavklarte rettigheter", () => {
    const res = evaluatePrintGate({ ...base, rights_cleared: false });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toContain("Rettighetene");
  });

  it("godtar rettighetsnotat som svar", () => {
    expect(
      evaluatePrintGate({
        ...base,
        rights_cleared: false,
        rights_note: "Kunden eier bildet",
      }),
    ).toEqual({ ok: true });
  });
});

describe("pickPrinterLabel", () => {
  const cals = [
    { printer_label: "Epson konditori", is_default: false },
    { printer_label: "Canon bakeri", is_default: true },
  ];

  it("bruker det maskinen sist valgte når kalibreringen finnes", () => {
    expect(pickPrinterLabel("Epson konditori", cals)).toBe("Epson konditori");
  });

  it("faller tilbake til standardskriveren når lagret valg er ukjent", () => {
    expect(pickPrinterLabel("Slettet skriver", cals)).toBe("Canon bakeri");
  });

  it("velger aldri en tilfeldig kalibrering uten standard", () => {
    expect(
      pickPrinterLabel(null, [{ printer_label: "Epson konditori", is_default: false }]),
    ).toBeNull();
  });

  it("beholder lagret valg når ingen kalibreringer finnes", () => {
    expect(pickPrinterLabel("Ukalibrert skriver", [])).toBe("Ukalibrert skriver");
  });
});
