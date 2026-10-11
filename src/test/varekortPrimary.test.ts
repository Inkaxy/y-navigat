import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: { ok: true, supplier_id: "s1", previous_supplier_id: null, link_created: false }, error: null })) },
}));

describe("varekort: Sett som primær / Lagre primær leverandør", () => {
  beforeEach(() => vi.clearAllMocks());
  it("sender rm_set_primary_supplier med råvaren og leverandøren etter koblingen", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { savePrimaryChoice } = await import("@/ravarer/lib/primaryChoice");
    expect(await savePrimaryChoice(true, { rm_id: "rm-1", supplier_id: "s1" })).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("rm_set_primary_supplier", { p_raw_material_id: "rm-1", p_supplier_id: "s1" });
  });
  it("kaller ikke serveren når valget er av eller varekortet er ukoblet", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { savePrimaryChoice } = await import("@/ravarer/lib/primaryChoice");
    expect(await savePrimaryChoice(false, { rm_id: "rm-1", supplier_id: "s1" })).toBe(false);
    expect(await savePrimaryChoice(true, { rm_id: null, supplier_id: "s1" })).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
