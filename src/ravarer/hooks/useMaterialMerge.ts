import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callPendingRpc, pendingSelect, useCapability } from "@/lib/pendingRpc";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import { useRavarerScope } from "@/ravarer/hooks/useRavarerScope";
import { parseMergeFacts, parseMergeOutcome, type MergeFacts, type MergeOutcome } from "@/ravarer/lib/merge/facts";

/** Kan brukeren slå sammen nå? `available` = PENDING-filen er kjørt; `allowed` = godkjenner/admin i Råvarer. */
export function useMergeAccess() {
  const cap = useCapability("rm_cap_slaa_sammen_v1");
  const level = useRavarerAccessLevel();
  const allowed = level.data === "approve" || level.data === "admin";
  return { available: cap, allowed, ready: cap === true && allowed };
}

export type FactsState = { kind: "ok"; items: MergeFacts[] } | { kind: "missing" } | { kind: "denied" } | { kind: "error"; text: string };

export function useMergeFacts(ids: readonly string[], enabled: boolean) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["ravarer", "merge-facts", ...sorted],
    enabled: enabled && ids.length >= 2,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<FactsState> => {
      const r = await callPendingRpc("rm_merge_facts", { p_ids: sorted }, signal);
      if (r.kind === "missing") return { kind: "missing" };
      if (r.kind === "denied") return { kind: "denied" };
      if (r.kind === "error") return { kind: "error", text: "Kunne ikke hente varene. Prøv igjen." };
      const p = parseMergeFacts(r.data);
      if (!p) return { kind: "error", text: "Svaret var uleselig. Prøv igjen." };
      if (!p.ok) return p.code === "ingen_tilgang" ? { kind: "denied" } : { kind: "error", text: "Kunne ikke hente varene." };
      return { kind: "ok", items: p.items };
    },
  });
}

export interface MergeRequest { keepId: string; dupIds: string[]; gramsPerPiece: Record<string, number>; fields: { name: string; category: string; item_type: string }; reason: string | null }
/** `unknown` = utfallet er ikke kjent (nett/5xx/uleselig): samme opId kan sendes på nytt trygt (svaret gjentas). */
export type RunResult = { kind: "done"; outcome: MergeOutcome } | { kind: "missing" } | { kind: "denied" } | { kind: "unknown" };

const toArgs = (r: MergeRequest, dryRun: boolean, opId: string) => ({
  p_keep: r.keepId, p_dups: r.dupIds,
  p_grams_per_piece: Object.keys(r.gramsPerPiece).length ? r.gramsPerPiece : null,
  p_fields: r.fields, p_reason: r.reason, p_dry_run: dryRun, p_op_id: opId,
});

async function run(name: string, args: Record<string, unknown>): Promise<RunResult> {
  const r = await callPendingRpc(name, args);
  if (r.kind === "missing") return { kind: "missing" };
  if (r.kind === "denied") return { kind: "denied" };
  if (r.kind === "error") return { kind: "unknown" };
  const outcome = parseMergeOutcome(r.data);
  return outcome ? { kind: "done", outcome } : { kind: "unknown" };
}

export function useMergeActions() {
  const qc = useQueryClient();
  // En sammenslåing flytter linjer, priser, oppskrifter og lager: alt hentet på nytt.
  const refreshAll = () => void qc.invalidateQueries();
  return {
    preview: (r: MergeRequest, opId: string) => run("rm_merge_raw_materials", toArgs(r, true, opId)),
    apply: async (r: MergeRequest, opId: string) => {
      const res = await run("rm_merge_raw_materials", toArgs(r, false, opId));
      if (res.kind === "done" && res.outcome.ok && !res.outcome.dryRun) refreshAll();
      return res;
    },
    previewUndo: (mergeId: string, opId: string) => run("rm_undo_material_merge", { p_merge_id: mergeId, p_dry_run: true, p_op_id: opId }),
    undo: async (mergeId: string, opId: string) => {
      const res = await run("rm_undo_material_merge", { p_merge_id: mergeId, p_dry_run: false, p_op_id: opId });
      if (res.kind === "done" && res.outcome.ok && !res.outcome.dryRun) refreshAll();
      return res;
    },
  };
}

export interface MergeLink { mergedIntoId: string | null; mergeId: string | null }
/** «Slått sammen med …» for én vare. Null = ikke kjørt / ikke sammenslått / ukjent (viser ingenting). */
export function useMergedInto(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["ravarer", "merged-into", id],
    enabled: enabled && !!id,
    queryFn: async ({ signal }): Promise<MergeLink | null> => {
      const r = await pendingSelect("raw_materials", `select=merged_into_id,merge_id&id=eq.${id}`, signal);
      if (r.kind !== "ok" || !Array.isArray(r.data) || r.data.length !== 1) return null;
      const row: unknown = r.data[0];
      if (typeof row !== "object" || row === null) return null;
      const m = row as Record<string, unknown>;
      const into = typeof m.merged_into_id === "string" ? m.merged_into_id : null;
      return into ? { mergedIntoId: into, mergeId: typeof m.merge_id === "string" ? m.merge_id : null } : null;
    },
  });
}

export interface KeptMerge { id: string; mergedIds: string[]; createdAt: string }
/** Aktive sammenslåinger der denne varen er den som ble beholdt (for «Angre sammenslåing»). */
export function useKeptMerges(id: string | undefined, enabled: boolean) {
  const { legalEntityId } = useRavarerScope();
  return useQuery({
    queryKey: ["ravarer", "kept-merges", legalEntityId, id],
    enabled: enabled && !!id && !!legalEntityId,
    queryFn: async ({ signal }): Promise<KeptMerge[] | null> => {
      const r = await pendingSelect("rm_material_merges", `select=id,merged_ids,created_at&keep_id=eq.${id}&legal_entity_id=eq.${legalEntityId}&undone_at=is.null&order=created_at.desc&limit=20`, signal);
      if (r.kind === "missing") return null;
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Kunne ikke hente sammenslåinger.");
      const out: KeptMerge[] = [];
      for (const row of r.data as unknown[]) {
        if (typeof row !== "object" || row === null) throw new Error("Uleselig svar.");
        const m = row as Record<string, unknown>;
        if (typeof m.id !== "string" || typeof m.created_at !== "string" || !Array.isArray(m.merged_ids) || !m.merged_ids.every((x) => typeof x === "string")) throw new Error("Uleselig svar.");
        out.push({ id: m.id, mergedIds: m.merged_ids as string[], createdAt: m.created_at });
      }
      return out;
    },
  });
}
