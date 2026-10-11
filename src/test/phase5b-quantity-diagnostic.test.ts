import { describe, expect, it, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const TABLES = vi.hoisted(() => ({ data: {} as Record<string, Row[]>, fail: new Set<string>(), writes: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "gte", "lte", "order"]) b[m] = () => b;
    for (const m of ["insert", "update", "upsert", "delete"]) b[m] = () => { TABLES.writes++; return b; };
    b.range = (from: number, to: number) =>
      Promise.resolve(TABLES.fail.has(table) ? { data: null, error: { message: "nede" } } : { data: (TABLES.data[table] ?? []).slice(from, to + 1), error: null });
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: () => { TABLES.writes++; } } };
});

import { fetchMissingQuantityLines } from "@/ravarer/pages/priskontroll/gjore/mengde/useMissingQuantityDiagnostic";

const line = (id: string, inv: string, n: string) => ({
  id, invoice_id: inv, description: "COCA-COLA", quantity: 48, unit: "stk", raw_material_id: "rm",
  invoice: { invoice_number: n, invoice_date: "2026-10-01", status: "reconciled" },
});

beforeEach(() => {
  TABLES.data = { raw_materials: [{ id: "rm", name: "Cola" }] };
  TABLES.fail = new Set();
  TABLES.writes = 0;
});

describe("Mengde i baseenhet — diagnostikk", () => {
  it("live-lignende avstemte linjer med purchase 48/24 vises som «bevegelse registrert», uten skriving", async () => {
    TABLES.data.invoice_lines = [line("f338384e", "be7121b9", "A"), line("9237ee6c", "dbd30a3f", "B")];
    TABLES.data.stock_movements = [
      { source_id: "f338384e", movement_type: "purchase", quantity_base: 48 },
      { source_id: "9237ee6c", movement_type: "purchase", quantity_base: 24 },
    ];
    const rows = await fetchMissingQuantityLines("le");
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.movement.status === "ok" && r.invoice_status === "reconciled")).toBe(true);
    expect(TABLES.writes).toBe(0);
  });
  it("uten bevegelse er «ingen», feilet oppslag er «ukjent» (aldri «ingen»)", async () => {
    TABLES.data.invoice_lines = [line("l1", "i1", "A")];
    expect((await fetchMissingQuantityLines("le"))[0].movement.status).toBe("none");
    TABLES.fail.add("stock_movements");
    expect((await fetchMissingQuantityLines("le"))[0].movement.status).toBe("unknown");
  });
  it("over 200 treff: siste rad er med (ingen stille avkorting)", async () => {
    TABLES.data.invoice_lines = Array.from({ length: 1205 }, (_, i) => line(`l${String(i).padStart(4, "0")}`, "i", "A"));
    const rows = await fetchMissingQuantityLines("le");
    expect(rows).toHaveLength(1205);
    expect(rows.some(r => r.id === "l1204")).toBe(true);
  });
  it("feil i linjeoppslag kastes (vises som feil, ikke tom liste)", async () => {
    TABLES.fail.add("invoice_lines");
    await expect(fetchMissingQuantityLines("le")).rejects.toBeTruthy();
  });
});
