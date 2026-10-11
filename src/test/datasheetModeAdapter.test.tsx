// @vitest-environment jsdom
/**
 * Produksjonsadapter `DatasheetMode` (liste=datablad): hver hendelse er egen rad, valg følger
 * `endring` (ikke bare råvare), og full detalj beholder hendelsen. Ingen ekte skriving: kvitteringen er mocket.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChangelogRow } from "@/ravarer/hooks/useDatasheets";

const ack = vi.fn();
const ev = (id: string, field: string, created_at: string): ChangelogRow => ({
  id, raw_material_id: "M1", legal_entity_id: "le", datasheet_id: null, change_type: "nutrition_changed", field,
  old_value: 1, new_value: 2, severity: "medium", affected_recipes_count: 0, acknowledged: false, acknowledged_by: null, acknowledged_at: null,
  created_at, raw_materials: { name: "Combisur", sku: "S1" },
});
vi.mock("@/ravarer/hooks/useDatasheets", () => ({
  useChangelog: () => ({ data: [ev("e1", "fat_g", "2026-09-02T10:00:00Z"), ev("e2", "salt_g", "2026-09-01T10:00:00Z")], isLoading: false, error: null, refetch: vi.fn() }),
  useAcknowledgeChange: () => ({ mutateAsync: ack, isPending: false }),
}));
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: true, legalEntityId: "le" }) }));
vi.mock("@/hooks/useUiPreference", () => ({ useUiPreference: <T,>(_s: string, f: T) => ({ value: f, setValue: vi.fn() }) }));

import { DatasheetMode, withEvent } from "@/ravarer/pages/varer/DatasheetMode";

let loc = "";
function Loc() { const l = useLocation(); loc = l.search; return null; }

describe("DatasheetMode — hendelsesidentitet", () => {
  it("to hendelser for samme råvare gir to rader; klikk velger hendelsen", () => {
    render(
      <MemoryRouter initialEntries={["/ravarer/varer?liste=datablad&endring=e2&valgt=M1"]}>
        <TooltipProvider><Routes><Route path="/ravarer/varer" element={<><DatasheetMode /><Loc /></>} /></Routes></TooltipProvider>
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole("row").filter((r) => r.textContent?.includes("Combisur"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const fatRow = rows.find((r) => /fett/i.test(r.textContent ?? ""));
    if (!fatRow) throw new Error("fant ikke fett-hendelsen");
    fireEvent.click(fatRow);
    const sp = new URLSearchParams(loc);
    expect(sp.get("endring")).toBe("e1");
    expect(sp.get("valgt")).toBe("M1");
    expect(ack).not.toHaveBeenCalled();
  });
  it("full detalj-lenke beholder hendelsen og listekonteksten", () => {
    const n = withEvent("liste=datablad&visning=alle", "e2");
    expect(n.get("endring")).toBe("e2");
    expect(n.get("visning")).toBe("alle");
  });
});
