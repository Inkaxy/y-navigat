import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchClaimPreview } from "@/ravarer/hooks/useClaimPreview";
import { ClaimSubmitError, planChanges, planClaim, type ClaimPlan, type ClaimPreviewLine } from "@/ravarer/lib/supplierClaim";

export type OkPlan = Extract<ClaimPlan, { ok: true }>;

export type ClaimFlowState = {
  /** Nøyaktig de linjene brukeren valgte (frosset ved start). */
  requested: string[];
  /** Gjeldende kontrollerte plan. Null = ingenting kan sendes. */
  plan: OkPlan | null;
  /** Forkastet plan etter at serveren meldte endret grunnlag. Brukes bare til sammenligning, aldri til innsending. */
  stalePlan: OkPlan | null;
  changes: string[];
  recheck: "idle" | "busy" | "error";
  blocked: { message: string; reasons: string[] } | null;
  duplicate: { openCaseId: string | null } | null;
};

const EMPTY: ClaimFlowState = { requested: [], plan: null, stalePlan: null, changes: [], recheck: "idle", blocked: null, duplicate: null };

/** Åpen sak som allerede inneholder en av linjene — bare fra data brukeren har lesetilgang til. */
export async function findOpenCaseForLines(lineIds: string[]): Promise<string | null> {
  if (lineIds.length === 0) return null;
  const { data, error } = await supabase
    .from("supplier_deviation_case_lines")
    .select("case_id, c:supplier_deviation_cases!inner(status)")
    .in("invoice_line_id", lineIds)
    .eq("c.status", "open")
    .limit(1);
  if (error) return null;
  return data?.[0]?.case_id ?? null;
}

type Deps = { preview?: (ids: string[]) => Promise<ClaimPreviewLine[]>; findOpenCase?: (ids: string[]) => Promise<string | null> };

/**
 * Forhåndsvisning → gjennomgang → innsending. Ved «grunnlaget er endret» forkastes planen;
 * ny kontroll gjelder de opprinnelig valgte linjene og sendes aldri automatisk.
 */
export function useClaimFlow(deps: Deps = {}) {
  const preview = deps.preview ?? fetchClaimPreview;
  const findOpen = deps.findOpenCase ?? findOpenCaseForLines;
  const [st, setSt] = useState<ClaimFlowState>(EMPTY);
  const gen = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; gen.current++; }; }, []);

  /** Første kontroll. Returnerer ikke-godkjent plan (for feilvisning) eller null ved suksess. */
  const start = async (ids: string[]): Promise<Extract<ClaimPlan, { ok: false }> | null> => {
    const my = ++gen.current;
    const pl = planClaim(await preview(ids));
    if (my !== gen.current) return null;
    if (!pl.ok) { setSt(EMPTY); return pl; }
    setSt({ ...EMPTY, requested: [...ids], plan: pl });
    return null;
  };

  /** Feil fra innsending. Returnerer melding som skal vises, eller null når flyten selv viser tilstanden. */
  const onSubmitError = async (e: unknown): Promise<string | null> => {
    if (e instanceof ClaimSubmitError && e.code === "stale") {
      setSt((s) => ({ ...s, stalePlan: s.plan ?? s.stalePlan, plan: null, changes: [], blocked: null, recheck: "idle" }));
      return null;
    }
    if (e instanceof ClaimSubmitError && e.code === "duplicate") {
      const ids = st.requested;
      // Sen oppslag fra en lukket/nyere flyt skal aldri åpne dialogen igjen.
      const my = gen.current;
      const openCaseId = await findOpen(ids);
      if (my !== gen.current || !alive.current) return null;
      setSt((s) => ({ ...s, duplicate: { openCaseId } }));
      return null;
    }
    return e instanceof Error ? e.message : "Saken kunne ikke opprettes.";
  };

  const recheck = async () => {
    const ids = st.requested;
    const prev = st.stalePlan;
    const my = ++gen.current;
    setSt((s) => ({ ...s, recheck: "busy", blocked: null, changes: [] }));
    try {
      const pl = planClaim(await preview(ids));
      if (my !== gen.current) return;
      if (!pl.ok) { setSt((s) => ({ ...s, recheck: "idle", plan: null, blocked: { message: pl.message, reasons: pl.reasons } })); return; }
      setSt((s) => ({ ...s, recheck: "idle", plan: pl, stalePlan: null, changes: prev ? planChanges(prev, pl) : [] }));
    } catch (err) {
      console.error("[claim-recheck]", err);
      if (my !== gen.current) return;
      setSt((s) => ({ ...s, recheck: "error", plan: null }));
    }
  };

  const close = () => { gen.current++; setSt(EMPTY); };
  const open = !!st.plan || !!st.stalePlan || !!st.blocked || st.recheck !== "idle" || !!st.duplicate;
  return { state: st, open, start, onSubmitError, recheck, close };
}
