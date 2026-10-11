import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { CountLinePayload } from "@/ravarer/lib/rpcContracts";
import {
  classifyCountError,
  CountOutcomeUnknownError,
  CountRejectedError,
  parseCountResult,
  type CountResult,
} from "@/ravarer/lib/countSubmission";

export type { CountResult } from "@/ravarer/lib/countSubmission";
export type { CountResultRow } from "@/ravarer/lib/rpcContracts";

export interface CountLineInput {
  raw_material_id: string;
  counted_base: number;
  /** Beholdningen som lå til grunn da telleren skrev tallet. */
  expected_base: number;
  line_note?: string | null;
  location?: string | null;
}

/** Sant når feilen kom av at beholdningen ble endret av andre underveis. */
export function isCountConflict(e: unknown): boolean {
  return e instanceof CountRejectedError && e.kind === "conflict";
}

/** Bygger den nøyaktige, ordnede linjelisten som sendes (og lagres for nytt forsøk). */
export function buildCountPayload(lines: CountLineInput[]): CountLinePayload[] {
  return lines.map(l => ({
    raw_material_id: l.raw_material_id,
    counted_base: l.counted_base,
    expected_base: l.expected_base,
    line_note: l.line_note ?? null,
    location: l.location ?? null,
  }));
}

function toJson(lines: CountLinePayload[]): Json {
  return lines.map(l => ({
    raw_material_id: l.raw_material_id,
    counted_base: l.counted_base,
    expected_base: l.expected_base,
    line_note: l.line_note ?? null,
    location: l.location ?? null,
  }));
}

/**
 * Bokfører en varetelling via `rm_stock_count_apply_v2`. Kalleren sender den
 * FERDIGE linjelisten (samme rekkefølge ved hvert forsøk); serveren er idempotent
 * på operasjons-ID + innhold. Transportfeil og uventet svar er ukjent utfall.
 */
export function useApplyRmStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { opId: string; lines: CountLinePayload[]; note: string }): Promise<CountResult> => {
      if (input.lines.length === 0) throw new CountRejectedError("rejected", "Ingen varer er talt opp");
      if (input.lines.some(l => !Number.isFinite(l.expected_base) || !Number.isFinite(l.counted_base))) {
        throw new CountRejectedError("rejected", "Mangler forventet eller talt beholdning for en eller flere linjer");
      }
      let res: { data: unknown; error: { code?: string; message?: string } | null };
      try {
        res = await supabase.rpc("rm_stock_count_apply_v2", {
          p_op_id: input.opId,
          p_lines: toJson(input.lines),
          p_note: input.note,
        });
      } catch (e) {
        console.warn("[varetelling] nettfeil", e);
        throw new CountOutcomeUnknownError();
      }
      if (res.error) throw classifyCountError(res.error);
      return parseCountResult(res.data, { opId: input.opId, materialIds: input.lines.map(l => l.raw_material_id) });
    },
    onSuccess: res => {
      invalidateRawMaterial(qc);
      void qc.invalidateQueries({ queryKey: ["all-stock-status"] });
      if (res.detailsUnavailable) {
        toast.success("Tellingen er bokført. Detaljene kunne ikke vises — se Bevegelser.");
        return;
      }
      if (res.alreadyApplied) {
        toast.success("Tellingen var allerede bokført — ingenting ble ført på nytt.");
        return;
      }
      toast.success(`Telling bokført: ${res.adjusted} justert, ${res.unchanged} uendret`);
    },
    onError: (e: unknown) => {
      if (e instanceof CountOutcomeUnknownError) {
        toast.error(e.message);
        return;
      }
      if (e instanceof CountRejectedError) {
        const suffix = e.kind === "content" ? "" : " Ingenting ble bokført.";
        toast.error(`${e.message}${suffix}`);
        return;
      }
      toast.error("Tellingen kunne ikke bokføres.");
    },
  });
}
