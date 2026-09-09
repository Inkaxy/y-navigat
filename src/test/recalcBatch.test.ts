import { describe, expect, it } from "vitest";
import {
  buildRecalcArgs,
  buildUndoRecalcArgs,
  chunkRawMaterialIds,
  isNonFatalPermissionError,
  summarizeRecalcItems,
  MAX_RECALC_BATCH_SIZE,
} from "@/ravarer/lib/recalcBatch";

describe("recalcBatch", () => {
  it("deler IDer i bolker på maks 500", () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);
    const chunks = chunkRawMaterialIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(MAX_RECALC_BATCH_SIZE);
    expect(chunks[2]).toHaveLength(200);
  });

  it("bygger dry-run og skarpe argumenter riktig", () => {
    expect(buildRecalcArgs({ rawMaterialIds: ["a", "b"], reason: "test", dryRun: true })).toEqual({
      p_raw_material_ids: ["a", "b"],
      p_reason: "test",
      p_dry_run: true,
    });
    expect(buildRecalcArgs({ rawMaterialIds: ["a"], reason: "test", dryRun: false }).p_dry_run).toBe(false);
  });

  it("krever batch_id for angring", () => {
    expect(buildUndoRecalcArgs("batch-1")).toEqual({ p_batch_id: "batch-1" });
    expect(() => buildUndoRecalcArgs("")).toThrow();
  });

  it("summerer ok/feil/beskyttet fra items[]", () => {
    const summary = summarizeRecalcItems([
      { raw_material_id: "1", ok: true, cost_before: 10, cost_after: 12 },
      { raw_material_id: "2", ok: false, error: "boom", cost_before: null, cost_after: null },
      { raw_material_id: "3", ok: true, cost_before: 5, cost_after: 5, manual_cost_protected: true },
    ]);
    expect(summary).toEqual({ okCount: 2, errorCount: 1, protectedCount: 1 });
  });

  it("42501 fra refresh_purchase_stats er ikke-fatal", () => {
    expect(isNonFatalPermissionError({ code: "42501" })).toBe(true);
    expect(isNonFatalPermissionError({ code: "42000" })).toBe(false);
    expect(isNonFatalPermissionError(null)).toBe(false);
  });
});
