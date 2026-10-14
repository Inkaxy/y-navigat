import { describe, expect, it } from "vitest";
import { confirmedPackageFor, doneSummary } from "@/fakturaer/lib/lineDoneSummary";
import { reasonGate } from "@/fakturaer/lib/priceSafety";

const link = { package_size: 100, package_unit: "g", base_units_per_package: 0.1, package_confirmed_at: "2026-01-01T10:00:00Z" };
const line = { package_size: 100, package_unit: "g", unit: "pose" };

describe("bekreftet pakning", () => {
  it("vises når koblingen er bekreftet og innholdet er likt", () => {
    expect(confirmedPackageFor(link, line)).toMatchObject({ size: 100, unit: "g", container: "pose", baseUnitsPerPackage: 0.1 });
  });
  it("ubekreftet, null-faktor eller annet innhold forblir forslag", () => {
    expect(confirmedPackageFor({ ...link, package_confirmed_at: null }, line)).toBeNull();
    expect(confirmedPackageFor({ ...link, base_units_per_package: null }, line)).toBeNull();
    expect(confirmedPackageFor(link, { ...line, package_size: 250 })).toBeNull();
    expect(confirmedPackageFor(null, line)).toBeNull();
  });
});

describe("ferdig linje", () => {
  it("skiller linjen, resten av fakturaen og prissammenligningen", () => {
    const d = doneSummary(12, reasonGate("price_reference_unverified"));
    expect(d.line).toMatch(/avklart/);
    expect(d.invoice).toMatch(/12 andre åpne linjer/);
    expect(d.price).toMatch(/Ingen dokumentert tidligere kjøpspris/);
    expect(d.price).toMatch(/eldste/);
  });
  it("ukjent antall er aldri 0, godkjent pris gir ingen prismelding", () => {
    const ok = { ok: true as const, safety: {} as never };
    expect(doneSummary(null, ok).invoice).not.toMatch(/Ingen andre/);
    expect(doneSummary(0, ok).price).toBeNull();
  });
  it("andre sperrer er uendret", () => {
    expect(reasonGate("price_observation_held")).toMatchObject({ label: "Prisgrunnlaget er til kontroll" });
    expect(reasonGate("credit_note")).toMatchObject({ action: "review_credit_note" });
  });
});
