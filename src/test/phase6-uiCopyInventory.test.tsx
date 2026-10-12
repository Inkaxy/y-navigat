// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, existsSync, statSync } from "node:fs";
import { correctionTarget } from "@/ravarer/pages/priskontroll/faktura/correctionTarget";
import { formatMachineNumbersNb, formatSignedPct, sumDirection, sumDirectionText } from "@/fakturaer/lib/sumDirection";
import { formatVariancePct } from "@/fakturaer/lib/linesSum";
import { allergenState, reviewedFrom, ALLERGEN_STATE_LABEL } from "@/ravarer/lib/allergenState";
import { StatusChips } from "@/ravarer/components/vareliste/VarelisteCells";
import { completenessChecklist } from "@/ravarer/lib/rawMaterialSections";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";
import { WorkspaceHeader } from "@/ravarer/pages/priskontroll/faktura/WorkspaceHeader";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("rettemål for «Rett sumavvik»", () => {
  const lines = [{ id: "a", issue: false }, { id: "b", issue: true }, { id: "c", issue: false }];
  const has = (l: { issue: boolean }) => l.issue;
  it("valgt linje på denne fakturaen vinner", () => expect(correctionTarget(lines, "c", has)).toEqual({ id: "c", reason: "valgt" }));
  it("valgt linje fra en annen faktura/kø brukes aldri", () => expect(correctionTarget(lines, "fremmed", has)).toEqual({ id: "b", reason: "lesevarsel" }));
  it("ingen valgt og ingen lesevarsel → ingen linje (ikke første linje)", () => expect(correctionTarget([{ id: "a", issue: false }], null, has)).toBeNull());
  it("ingen linjer → ingen mål", () => expect(correctionTarget([], "a", has)).toBeNull());
});

describe("retningsbestemt sumtekst (PALS 526301-fixture)", () => {
  // Bare testdata: brutto 29 652,45, mva 3 867,71, netto 25 784,74 mot lagrede linjer 343 103,50.
  it("for høy linjesum sier ikke at linjer mangler", () => {
    const d = sumDirection(343103.5, 29652.45 - 3867.71);
    expect(d).toBe("for_hoy");
    expect(sumDirectionText(d)).toMatch(/mer enn fakturaen/);
    expect(sumDirectionText(d)).not.toMatch(/mangle/);
  });
  it("for lav linjesum", () => expect(sumDirectionText(sumDirection(100, 200))).toMatch(/mangle linjer/));
  it("ukjent netto eller ulikt fortegn → nøytral", () => {
    expect(sumDirection(100, null)).toBe("ukjent");
    expect(sumDirection(-100, 200)).toBe("ukjent");
    expect(sumDirectionText("ukjent")).toBe("Summen må kontrolleres mot originalen.");
  });
  it("kreditnota med negative beløp følger størrelsen", () => {
    expect(sumDirection(-300, -200)).toBe("for_hoy");
    expect(sumDirection(-100, -200)).toBe("for_lav");
    expect(sumDirectionText("for_hoy", true)).toMatch(/kreditnotaen/);
  });
});

describe("norske tall i visning", () => {
  it("1230.6 % vises som 1 230,6 %", () => expect(nbsp(formatVariancePct(1230.6))).toBe("+1 230,6 %"));
  it("fortegn, null og ukjent", () => {
    expect(nbsp(formatSignedPct(-2.25))).toBe("−2,3 %");
    expect(formatSignedPct(0)).toBe("0,0 %");
    expect(formatSignedPct(null)).toBe("—");
  });
  it("liten reell endring blir ikke 0 %", () => {
    expect(formatSignedPct(0.01)).toBe("+<0,1 %");
    expect(formatSignedPct(-0.01)).toBe("−<0,1 %");
  });
  it("maskintall i lesevarsel gjøres norske uten å endre teksten ellers", () => {
    expect(nbsp(formatMachineNumbersNb("Mengde × pris (1130000.00) stemmer ikke med linjesummen (113000.00)."))).toBe("Mengde × pris (1 130 000,00) stemmer ikke med linjesummen (113 000,00).");
    expect(formatMachineNumbersNb("Ingen tall her")).toBe("Ingen tall her");
  });
});

const item = (over: Partial<RawMaterialListItem>): RawMaterialListItem => ({
  declarationName: "x", hasDatasheet: true, hasNutrition: true, hasAllergens: false, allergensReviewed: null, ...over,
} as RawMaterialListItem);

describe("allergener: vurdert er adskilt fra registrert", () => {
  const cases: Array<[boolean, boolean, string]> = [
    [true, false, "vurdert_ingen"], [true, true, "vurdert_med"], [false, false, "ikke_vurdert"], [false, true, "ikke_vurdert"],
  ];
  it.each(cases)("vurdert=%s registrert=%s → %s", (rev, has, want) => expect(allergenState(rev, has)).toBe(want));
  it("ukjent vurdering fabrikkeres ikke", () => {
    expect(reviewedFrom(undefined)).toBeNull();
    expect(allergenState(null, false)).toBe("ukjent");
  });
  it.each(cases)("listebrikke og råvarekort er enige (vurdert=%s, registrert=%s)", (rev, has, want) => {
    const at = rev ? "2026-10-02T17:44:24.546+00" : null;
    render(<StatusChips item={item({ hasAllergens: has, allergensReviewed: reviewedFrom(at) })} />);
    const chip = screen.getByLabelText(ALLERGEN_STATE_LABEL[want as keyof typeof ALLERGEN_STATE_LABEL]);
    expect(chip.className.includes("text-success")).toBe(rev);
    const detail = completenessChecklist({ rm: { is_packaging: false, allergens_reviewed_at: at, base_units_per_package: null, categories: null }, linkCount: 0, nutrition: null, hasDatasheet: false, costEvidence: { status: "mangler", reason: null } } as unknown as Parameters<typeof completenessChecklist>[0]).find((c) => c.id === "allergener");
    expect(detail?.status === "ok").toBe(rev);
  });
});

describe("fakturahodet: egen sumkontroll og 44 px mål", () => {
  const base = {
    backHref: "/ravarer/priskontroll", supplier: "PALS", invoiceNumber: "526301", invoiceDate: "2026-10-01", amount: 29652.45,
    status: "pending", steps: [], next: { key: "rett_sum", label: "Rett sumavvik", enabled: true, hint: "" },
    busy: false, canWrite: true, canFetch: false, canCorrect: true, sumMismatch: true, docPath: "x.pdf", docOpen: false,
    onToggleDoc: vi.fn(), onPrimary: vi.fn(), onMenu: vi.fn(), onUndo: vi.fn(), isCreditNote: false,
  };
  it("menyen har «Vis sumkontroll» adskilt fra retting, og knappene er 44 px", async () => {
    const onMenu = vi.fn(); const onPrimary = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><WorkspaceHeader {...(base as unknown as Parameters<typeof WorkspaceHeader>[0])} onMenu={onMenu} onPrimary={onPrimary} /></MemoryRouter></QueryClientProvider>);
    const more = screen.getByRole("button", { name: "Flere valg for fakturaen" });
    expect(more.className).toContain("h-[44px]");
    expect(screen.getByRole("button", { name: /Vis dokument/ }).className).toContain("min-h-[44px]");
    const primary = screen.getByRole("button", { name: "Rett sumavvik" });
    expect(primary.className).toContain("min-h-[44px]");
    fireEvent.click(primary);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    more.focus(); fireEvent.keyDown(more, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Vis sumkontroll" }));
    expect(onMenu).toHaveBeenCalledWith("facts");
  });
});

describe("eksakt 313-kartlegging", () => {
  type Rec = { id: string; route_owner_path: string; action_component_paths: string[]; canonical_url_templates: string[]; original_feature: string; current_feature: string; mapping_status: string; acceptance: string; browser_check: string; source_review: string };
  const doc = JSON.parse(readFileSync("docs/ravarer-funksjonsmapping.json", "utf8")) as { provenance: { inspected_base_sha: string }; records: Rec[] };
  const recs = doc.records;
  it("R1–R203 og F1–F110, ingen duplikater eller hull", () => {
    const ids = recs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const want = [...Array.from({ length: 203 }, (_, i) => `R${i + 1}`), ...Array.from({ length: 110 }, (_, i) => `F${i + 1}`)];
    expect([...ids].sort()).toEqual([...want].sort());
  });
  it("eksakte filer (ingen mapper), URL-er som liste uten sammenslåtte strenger, ingen falsk aksept", () => {
    expect(doc.provenance.inspected_base_sha).toMatch(/^[0-9a-f]{40}$/);
    const md = readFileSync("docs/ravarer-funksjonsliste.md", "utf8").split("## Fase 6")[0];
    const mdIds = new Set([...md.matchAll(/^\| ([RF]\d+(?:, [RF]\d+)*) \|/gm)].flatMap((m) => m[1].split(", ")));
    expect(mdIds.size).toBe(313);
    for (const r of recs) {
      expect(mdIds.has(r.id)).toBe(true);
      expect(r.original_feature, r.id).toBeTruthy();
      for (const f of [r.route_owner_path, ...r.action_component_paths]) {
        expect(existsSync(f) && statSync(f).isFile(), `${r.id}: ${f}`).toBe(true);
      }
      expect(r.canonical_url_templates.length).toBeGreaterThan(0);
      for (const u of r.canonical_url_templates) expect(u, r.id).toMatch(/^\/[^|· ]*$/);
      expect(r.acceptance).toBe("ikke akseptert");
      expect(r.mapping_status).not.toBe("feil");
    }
  });
  it("tidligere bevis bevares per ID og nullstilles ikke globalt", () => {
    const by = new Map(recs.map((r) => [r.id, r]));
    expect(by.get("R14")?.browser_check).toBe("targeted_readonly_pass_9915");
    expect(by.get("R83")?.browser_check).toBe("ukjent");
  });
  it("ingen ID står igjen som bare «eierfil finnes»; hvert spor har ordrett bevis i fila", () => {
    for (const r of recs as unknown as Array<Rec & { handler_or_render_evidence: { file: string; evidence: string }[] }>) {
      expect(r.mapping_status, r.id).not.toBe("eier_verifisert_handling_ikke_sporet");
      for (const h of r.handler_or_render_evidence ?? []) expect(readFileSync(h.file, "utf8").includes(h.evidence), `${r.id}: ${h.file}`).toBe(true);
    }
  });
  it("R192/R195 beholder original funksjonstekst", () => {
    const by = new Map(recs.map((r) => [r.id, r]));
    expect(by.get("R192")?.current_feature).toBe("Visning av før, etter, endring, kilde og regnestykke");
    expect(by.get("R195")?.current_feature).toBe("Lenker til Pakninger og fakturaer");
  });
  it("kontrollerte adresser: mottak/godkjenning/innstillinger/import bruker parserens verdier", () => {
    const by = new Map(recs.map((r) => [r.id, r]));
    expect(by.get("R81")?.canonical_url_templates).toEqual(["/ravarer/lager?fane=varemottak"]);
    expect(by.get("F85")?.canonical_url_templates).toEqual(["/ravarer/priskontroll?fane=godkjenning"]);
    expect(by.get("R187")?.canonical_url_templates).toEqual(["/ravarer/innstillinger?seksjon=tripletex"]);
    expect(by.get("F96")?.canonical_url_templates).toEqual(["/ravarer/priskontroll?importer=pdf"]);
    expect(by.get("R79")?.canonical_url_templates).toEqual(["/ravarer/priskontroll?fane=gjore&visning=mengde"]);
  });
});
