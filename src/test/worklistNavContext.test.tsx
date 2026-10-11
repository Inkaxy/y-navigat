// @vitest-environment jsdom
/** Råvarekortets forrige/neste: ekte hook, mockede datakilder. Hopp over (økt) og borte rad. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { writeNutritionSkipped } from "@/ravarer/lib/nutritionSkip";

const cov = { data: { candidates: [
  { raw_material_id: "a", name: "Anis" }, { raw_material_id: "b", name: "Bygg" }, { raw_material_id: "c", name: "Cider" },
] } as { candidates: { raw_material_id: string; name: string }[] } | undefined };
const ds = { data: [{ id: "e1", raw_material_id: "m1", raw_material_name: "Mel", created_at: "2026-10-01" }] as unknown[] | undefined };

vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: "le", canWrite: true }) }));
vi.mock("@/ravarer/hooks/useVarelisteItems", () => ({ useVarelisteItems: () => ({ items: [] }) }));
vi.mock("@/ravarer/hooks/usePackageSizes", () => ({ usePackageWorklist: () => ({ data: undefined }) }));
vi.mock("@/ravarer/hooks/useSuspiciousPackages", () => ({ useSuspiciousPackages: () => ({ data: undefined }) }));
vi.mock("@/ravarer/hooks/useDeclarationNames", () => ({ useDeclarationWorklist: () => ({ data: undefined }) }));
vi.mock("@/ravarer/hooks/useNutritionCoverage", () => ({ useNutritionCoverage: () => ({ data: cov.data }) }));
vi.mock("@/ravarer/hooks/useDatasheets", () => ({ useChangelog: () => ({ data: ds.data }) }));
vi.mock("@/fakturaer/hooks/useMatchTolerances", () => ({ DEFAULT_HARD_CAP_PCT: 15, useMatchTolerances: () => ({ settings: null, toleranceFor: () => 3 }) }));

import { useWorklistNav } from "@/ravarer/pages/varer/useWorklistNav";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => { sessionStorage.clear(); });

describe("useWorklistNav", () => {
  it("næring: rader som er hoppet over i økten er ikke naboer", () => {
    writeNutritionSkipped("le", new Set(["b"]));
    const { result } = renderHook(() => useWorklistNav("liste=naering", "a", null), { wrapper });
    expect(result.current.next?.materialId).toBe("c");
    expect(result.current.total).toBe(2);
  });

  it("borte rad (kvittert datablad-hendelse): ingen falske naboer, neste = første i gjeldende liste", () => {
    const { result } = renderHook(() => useWorklistNav("liste=datablad", "m1", "borte-hendelse"), { wrapper });
    expect(result.current.missing).toBe(true);
    expect(result.current.prev).toBeNull();
    expect(result.current.next?.materialId).toBe("m1");
  });

  it("mens listen laster er raden ikke «borte»", () => {
    const keep = ds.data;
    ds.data = undefined;
    const { result } = renderHook(() => useWorklistNav("liste=datablad", "m1", "e1"), { wrapper });
    expect(result.current.missing).toBe(false);
    ds.data = keep;
  });
});
