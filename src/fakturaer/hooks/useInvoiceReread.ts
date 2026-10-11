import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { clearPending, parseRun, savePending, type Operation, type RereadRun } from "@/fakturaer/lib/reread";

const COLS = "id, invoice_id, legal_entity_id, created_by, status, error_code, created_at, expires_at, document_path, snapshot, proposal, extractor, result, applied_operations, apply_reason";
export const rereadKey = (runId: string | null) => ["invoice-reread-run", runId] as const;

export async function fetchRereadRun(runId: string): Promise<RereadRun | null> {
  const { data, error } = await supabase.from("invoice_reread_runs").select(COLS).eq("id", runId).maybeSingle();
  if (error) throw error;
  return data ? parseRun(data) : null;
}

/** Lagret kjøring. Polles mens leseren arbeider — kallet til leseren gjentas aldri blindt. */
export function useRereadRun(runId: string | null) {
  return useQuery({
    queryKey: rereadKey(runId),
    enabled: !!runId,
    queryFn: () => fetchRereadRun(runId!),
    refetchInterval: (q) => (q.state.data?.status === "reading" ? 4000 : false),
  });
}

function messageOf(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return "ukjent";
}

type Begin = { ok: true; run_id: string } | { ok: false; code: string };
function parseBegin(d: Json): Begin {
  if (d && typeof d === "object" && !Array.isArray(d)) {
    if (d.ok === true && typeof d.run_id === "string") return { ok: true, run_id: d.run_id };
    if (typeof d.code === "string") return { ok: false, code: d.code };
  }
  return { ok: false, code: "ukjent" };
}

export function useBeginReread() {
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.rpc("rm_begin_invoice_reread", { p_invoice_id: invoiceId });
      if (error) throw new Error(messageOf(error));
      return parseBegin(data);
    },
  });
}

/** Ett kall til leseren per kjøring. Svar/timeout tolkes ikke — UI leser kjøringen fra databasen etterpå. */
export function useInvokeRereadPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.functions.invoke("reread-invoice-preview", { body: { run_id: runId } });
      const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : null;
      return { code: error ? code ?? "ukjent_utfall" : code };
    },
    onSettled: (_d, _e, runId) => { void qc.invalidateQueries({ queryKey: rereadKey(runId) }); },
  });
}

export function useCancelReread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc("rm_cancel_invoice_reread", { p_run_id: runId });
      if (error) throw new Error(messageOf(error));
    },
    onSettled: (_d, _e, runId) => { void qc.invalidateQueries({ queryKey: rereadKey(runId) }); },
  });
}

export type ApplyOutcome = { kind: "applied" } | { kind: "rejected"; message: string } | { kind: "unknown" };

/**
 * Ta i bruk: lagrer nøyaktig forespørsel FØR kallet. Ved ukjent utfall leses kjøringen; bare samme
 * forespørsel kan sendes igjen. Ingen ny kjøring startes automatisk, ingen matching/kostpris fra klienten.
 */
export function useApplyReread(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { runId: string; operations: Operation[]; reason: string }): Promise<ApplyOutcome> => {
      savePending(a);
      const ops: Json = JSON.parse(JSON.stringify(a.operations));
      try {
        const { error } = await supabase.rpc("rm_apply_invoice_reread", { p_run_id: a.runId, p_operations: ops, p_reason: a.reason });
        if (!error) { clearPending(a.runId); return { kind: "applied" }; }
        // Databasefeil med kode = kjent avvisning; ingenting er lagret (én transaksjon).
        if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) { clearPending(a.runId); return { kind: "rejected", message: error.message }; }
      } catch (e) {
        console.error("[reread-apply]", e);
      }
      const run = await fetchRereadRun(a.runId).catch(() => null);
      if (run?.status === "applied") { clearPending(a.runId); return { kind: "applied" }; }
      return { kind: "unknown" };
    },
    onSettled: (_d, _e, a) => {
      void qc.invalidateQueries({ queryKey: rereadKey(a.runId) });
      invalidateInvoice(qc, invoiceId);
      invalidateRavarerCounts(qc);
    },
  });
}
