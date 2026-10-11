import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

describe("varekort: Sett som primær — hele mutasjonskjeden", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { ok: true, supplier_id: "s1", previous_supplier_id: null, link_created: false }, error: null }); });

  it("kaller rm_set_primary_supplier og invaliderer råvaren og varekortlistene", async () => {
    const { savePrimaryAndRefresh } = await import("@/ravarer/lib/primaryChoice");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    expect(await savePrimaryAndRefresh(qc, true, { rm_id: "rm-1", supplier_id: "s1" })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("rm_set_primary_supplier", { p_raw_material_id: "rm-1", p_supplier_id: "s1" });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["supplier-items"]));
    expect(keys).toContain(JSON.stringify(["raw_material", "rm-1"]));
  });

  it("kaster norsk feil og invaliderer ingenting når serveren avviser", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { savePrimaryAndRefresh } = await import("@/ravarer/lib/primaryChoice");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await expect(savePrimaryAndRefresh(qc, true, { rm_id: "rm-1", supplier_id: "s1" })).rejects.toThrow("Kunne ikke sette primærleverandør");
    expect(spy).not.toHaveBeenCalled();
  });

  it("gjør ingenting når valget er av eller varekortet er ukoblet", async () => {
    const { savePrimaryAndRefresh } = await import("@/ravarer/lib/primaryChoice");
    const qc = new QueryClient();
    expect(await savePrimaryAndRefresh(qc, false, { rm_id: "rm-1", supplier_id: "s1" })).toBe(false);
    expect(await savePrimaryAndRefresh(qc, true, { rm_id: null, supplier_id: "s1" })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
