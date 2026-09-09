import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { CountApplyResult, CountLinePayload } from "@/ravarer/lib/rpcContracts";

export interface CountLineInput {
  raw_material_id: string;
  counted_base: number;
  /** Beholdningen som lå til grunn da telleren skrev tallet. */
  expected_base?: number | null;
  line_note?: string | null;
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
  alreadyApplied: boolean;
}

/** Sant når feilen kom av at beholdningen ble endret av andre underveis. */
export function isCountConflict(message: string): boolean {
  return /Beholdningen er endret av andre/i.test(message);
}

function normalize(data: unknown): CountResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Tellingen ga et uventet svar fra serveren. Ingenting er bokført.");
  }
  const res = data as Partial<CountResult> & { error?: string; already_applied?: boolean };
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
    alreadyApplied: res.already_applied === true,
  };
}

/**
 * Bokfører en varetelling via `rm_stock_count_apply_v2`: den låser varene i fast
 * rekkefølge, avviser tellingen hvis beholdningen er endret av andre underveis
 * (feilkode 40001), avviser duplikat linjeinnhold (23505), og er idempotent på
 * operasjons-ID-en — et nytt forsøk etter nettbrudd dobbeltfører altså ikke.
 */
export function useApplyRmStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { opId: string; lines: CountLineInput[]; note: string }): Promise<CountResult> => {
      if (input.lines.length === 0) throw new Error("Ingen varer er talt opp");
      const missingExpected = input.lines.find(l => l.expected_base == null);
      if (missingExpected) throw new Error("Mangler forventet beholdning for en eller flere linjer");
      const payload: CountLinePayload[] = input.lines.map(l => ({
        raw_material_id: l.raw_material_id,
        counted_base: l.counted_base,
        expected_base: l.expected_base as number,
        line_note: l.line_note ?? null,
      }));
      const { data, error } = await supabase.rpc("rm_stock_count_apply_v2", {
        p_op_id: input.opId,
        p_lines: payload as unknown as never,
        p_note: input.note,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Tellingen inneholder annet innhold enn forventet");
        if (error.code === "40001") throw new Error("Beholdningen er endret av andre — last på nytt og prøv igjen");
        throw error;
      }
      return normalize(data as unknown as CountApplyResult);
    },
    onSuccess: res => {
      invalidateRawMaterial(qc);
      if (res.alreadyApplied) {
        toast.success("Tellingen var allerede bokført — ingenting ble ført på nytt.");
        return;
      }
      toast.success(`Telling bokført: ${res.adjusted} justert, ${res.unchanged} uendret`);
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "Tellingen kunne ikke bokføres";
      toast.error(
        isCountConflict(message)
          ? `${message}. Ingenting er bokført — oppdater beholdningen og tell disse varene på nytt.`
          : message,
      );
    },
  });
}
