import { describe, expect, it } from "vitest";
import { invoiceReadingHealth, readingBannerState } from "./invoiceReadingHealth";

const failing = invoiceReadingHealth({
  usage: [{ success: false, error_message: "401 Incorrect API key provided", created_at: "2026-11-16T08:00:00Z" }],
  lastSuccessAt: "2026-11-10T08:00:00Z",
  aiErrorInvoices: [],
});

describe("varsel for fakturalesing etter nøkkeltest", () => {
  it("stillstand uten nøkkeltest", () => {
    expect(failing.state).toBe("failing");
    expect(readingBannerState(failing, null)).toBe("failing");
  });
  it("vellykket nøkkeltest etter siste feil gir «venter på første lesing»", () => {
    expect(readingBannerState(failing, "2026-11-16T09:00:00Z")).toBe("key_ok_waiting");
  });
  it("ny feil etter testen gir stillstand igjen", () => {
    expect(readingBannerState(failing, "2026-11-16T07:00:00Z")).toBe("failing");
  });
  it("vellykket lesing fjerner varselet helt", () => {
    const ok = invoiceReadingHealth({ usage: [{ success: true, error_message: null, created_at: "2026-11-16T10:00:00Z" }], lastSuccessAt: null, aiErrorInvoices: [] });
    expect(readingBannerState(ok, "2026-11-16T09:00:00Z")).toBeNull();
  });
});
