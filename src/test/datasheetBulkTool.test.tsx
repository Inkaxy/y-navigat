// @vitest-environment jsdom
/** Verktøy datablad-opplasting (R147–R154): ekte side og rydding, mocket I/O. Ingen opplasting, AI eller sletting. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseApplyOutcome, parseCandidates, retryStage, safeForBulk, summarizeExtract, type BulkRowLike } from "@/ravarer/lib/datasheetBulk";

const calls: string[] = [];
const deleteFilters: unknown[][] = [];
let deleteReturns: { id: string }[] = [];
const orphans = [{ id: "o1", file_name: "gammel.pdf", file_path: "le/bulk/x/gammel.pdf", supplier_name: "Regal", uploaded_at: "2026-09-01", status: "done", ai_confidence: null }];

vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: true, legalEntityId: "le" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn((m: string) => calls.push(`toast:${m}`)), info: vi.fn() } }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({ useRawMaterials: () => ({ data: [] }), useRawMaterial: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock("@/ravarer/hooks/useNutrition", () => ({ useNutrition: () => ({ data: null, isLoading: false, isError: false }), useAllergens: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock("@/ravarer/editors/PackageEditor", () => ({ PackageEditor: () => null }));
vi.mock("@/ravarer/editors/RawMaterialCreateSheet", () => ({ RawMaterialCreateSheet: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const filters: unknown[][] = [];
    const c = {
      select: (cols: string) => { filters.push(["select", cols]); return c; },
      insert: () => { calls.push(`insert:${table}`); return c; },
      update: () => { calls.push(`update:${table}`); return c; },
      delete: () => { calls.push(`delete:${table}`); filters.push(["delete"]); return c; },
      eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return c; },
      is: (k: string, v: unknown) => { filters.push(["is", k, v]); return c; },
      in: (k: string, v: unknown) => { filters.push(["in", k, v]); return c; },
      order: () => c, limit: () => c, single: () => c, maybeSingle: () => c,
      then: (res: (v: { data: unknown; error: null }) => void) => {
        if (filters.some((f) => f[0] === "delete")) { deleteFilters.push(...filters); return res({ data: deleteReturns, error: null }); }
        if (table === "raw_material_datasheets") return res({ data: orphans, error: null });
        return res({ data: null, error: null });
      },
    };
    return c;
  };
  return { supabase: { from: chain, functions: { invoke: vi.fn(() => { calls.push("invoke"); return Promise.resolve({ data: null, error: null }); }) }, storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) }, auth: { getUser: async () => ({ data: { user: null } }) } } };
});

import DatabladBulk from "@/ravarer/pages/DatabladBulk";

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><DatabladBulk /></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => { calls.length = 0; deleteFilters.length = 0; deleteReturns = []; });

describe("DatabladBulk — side", () => {
  it("mer enn 100 filer avvises med tydelig beskjed og ingen opplasting/AI", async () => {
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error("mangler filvelger");
    const files = Array.from({ length: 101 }, (_, i) => new File(["x"], `f${i}.pdf`, { type: "application/pdf" }));
    await act(async () => { fireEvent.change(input, { target: { files } }); });
    expect(calls.some((c) => c.includes("Du valgte 101 filer. Maks 100"))).toBe(true);
    expect(calls).not.toContain("invoke");
    expect(calls.some((c) => c.startsWith("insert"))).toBe(false);
  });

  it("rydding: Avbryt i slettedialogen gir 0 slettekall", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Slett gammel.pdf" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(0);
  });

  it("rydding: sletting er én betinget setning (utvalg + selskap + fortsatt uten råvare); koblet i mellomtiden beholdes", async () => {
    deleteReturns = []; // serveren slettet ingenting: bladet ble koblet etter at listen ble hentet
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Slett gammel.pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Slett" }));
    await waitFor(() => expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(1));
    expect(deleteFilters).toEqual(expect.arrayContaining([["in", "id", ["o1"]], ["eq", "legal_entity_id", "le"], ["is", "raw_material_id", null], ["select", "id"]]));
  });

  it("foreldreløse blad kan åpnes før sletting", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Åpne gammel.pdf" })).toBeInTheDocument();
  });
});

const row = (o: Partial<BulkRowLike>): BulkRowLike => ({
  key: "k", status: "ready", datasheet_id: "d", applyState: "idle", manualTarget: false, selectedRm: "A",
  candidates: [{ id: "A", name: "A", sku: "1", score: 0.92 }, { id: "B", name: "B", sku: "2", score: 0.41 }], ...o,
});

describe("DatabladBulk — regler", () => {
  it("bare GJENNOMGÅTT toppkandidat med høy score er trygg for samlet bekreftelse; valgt B arver ikke A sin score", () => {
    const rev = { entity: "le", gen: 1, datasheetId: "d", rmId: "A", fields: ["nutrition" as const], nutritionFields: ["fat_g"] };
    expect(safeForBulk(row({}), "le", 1)).toBe(false); // ikke gjennomgått
    expect(safeForBulk(row({ reviewed: rev }), "le", 1)).toBe(true);
    expect(safeForBulk(row({ reviewed: rev }), "annet", 1)).toBe(false); // annet selskap
    expect(safeForBulk(row({ reviewed: rev }), "le", 2)).toBe(false); // ny generasjon
    expect(safeForBulk(row({ reviewed: { ...rev, rmId: "B" } }), "le", 1)).toBe(false); // gjennomgått mot annet mål
    expect(safeForBulk(row({ selectedRm: "B", manualTarget: true }))).toBe(false);
    expect(safeForBulk(row({ selectedRm: "B" }))).toBe(false);
    expect(safeForBulk(row({ candidates: [{ id: "A", name: "A", sku: "", score: 0.6 }] }))).toBe(false);
    expect(safeForBulk(row({ applyState: "applying" }))).toBe(false);
    expect(safeForBulk(row({ applyState: "applied" }))).toBe(false);
  });
  it("bare applied:true med tom failures er anvendt; 207 er DELVIS; tom/ugyldig/applied:false er UKJENT", () => {
    const out = parseApplyOutcome({ applied: false, changes_logged: 3, failures: ["grain: ukjent"], follow_ups: { allergen_removals_skipped: ["melk"], package_suggestion: { suggested: { size: 20, unit: "kg" } } } });
    expect(out.kind).toBe("partial");
    expect(out.failures).toEqual(["grain: ukjent"]);
    expect(out.allergenRemovalsSkipped).toEqual(["melk"]);
    expect(out.packageSuggestion).toEqual({ size: 20, unit: "kg" });
    expect(parseApplyOutcome({ applied: true, failures: [], changes_logged: 2 }).kind).toBe("applied");
    expect(parseApplyOutcome({}).kind).toBe("unknown");
    expect(parseApplyOutcome({ applied: false, failures: [] }).kind).toBe("unknown");
    expect(parseApplyOutcome({ applied: true }).kind).toBe("unknown");
    expect(parseApplyOutcome(null).kind).toBe("unknown");
    expect(parseApplyOutcome({ error: "Ingen tilgang" }).kind).toBe("failed");
  });
  it("forhåndsvisningen viser serverens brødskala (grain_classification_hint), ikke et ja/nei", () => {
    expect(summarizeExtract({ grain_classification_hint: "grovt" }).grain).toBe("grovt");
    expect(summarizeExtract({ grain: true }).grain).toBeNull();
  });
  it("nytt forsøk med eksisterende datablad kjører bare matching (ingen ny AI-lesing)", () => {
    expect(retryStage({ storage_path: "p", datasheet_id: "d" })).toBe("match");
    expect(retryStage({ storage_path: "p" })).toBe("extract");
    expect(retryStage({})).toBe("upload");
  });
  it("kandidater sorteres og ugyldige forkastes; AI-sammendrag", () => {
    expect(parseCandidates({ candidates: [{ id: "b", score: 0.3 }, { id: "a", score: 0.9, name: "A" }, { score: 1 }] }).map((c) => c.id)).toEqual(["a", "b"]);
    const s = summarizeExtract({ name: "Combisur", nutrition: { fat_g: 1, salt_g: 0.2 }, allergens: ["hvete"], ingredient_declaration: "hvetemel, salt" });
    expect(s).toMatchObject({ name: "Combisur", nutritionFields: 2, allergens: ["hvete"], declaration: "hvetemel, salt" });
  });
});
