import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

export interface CountLineInput {
  raw_material_id: string;
  counted_base: number;
}

export interface CountResultRow {
  raw_material_id: string;
  name?: string | null;
  before?: number | null;
  counted?: number | null;
  diff?: number | null;
}

export interface CountResult {
  ok: boolean;
  adjusted: number;
  unchanged: number;
  rows: CountResultRow[];
}

/** Bokfører en varetelling via RPC rm_stock_count_apply. */
export function useApplyRmStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lines: CountLineInput[]; note: string }): Promise<CountResult> => {
      if (input.lines.length === 0) throw new Error("Ingen varer er talt opp");
      const { data, error } = await supabase.rpc("rm_stock_count_apply", {
        p_lines: input.lines as unknown as never,
        p_note: input.note,
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Tellingen ga et uventet svar fra serveren. Ingenting er bokført.");
      }
      const res = data as Partial<CountResult> & { error?: string };
      // ok === false betyr at serveren avviste tellingen — det er en feil, ikke en suksess.
      if (res.ok === false) {
        throw new Error(res.error ?? "Serveren avviste tellingen. Ingenting er bokført.");
      }
      if (typeof res.adjusted !== "number" && typeof res.adjusted !== "string") {
        throw new Error("Tellingen mangler svar på hvor mange varer som ble justert.");
      }
      return {
        ok: true,
        adjusted: Number(res.adjusted ?? 0),
        unchanged: Number(res.unchanged ?? 0),
        rows: Array.isArray(res.rows) ? (res.rows as CountResultRow[]) : [],
      };
    },
    onSuccess: res => {
      invalidateRawMaterial(qc);
      toast.success(`Telling bokført — ${res.adjusted} justert, ${res.unchanged} uendret`);
    },
    onError: (e: unknown) => toast.error(`Kunne ikke bokføre telling: ${e instanceof Error ? e.message : String(e)}`),
  });
}
