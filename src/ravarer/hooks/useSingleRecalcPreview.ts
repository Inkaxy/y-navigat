import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { parseSingleRecalcPreview, type SinglePreview } from "@/ravarer/lib/singleRecalcPreview";

/** Raden detaljen ble åpnet fra. Navn/grunnenhet brukes bare til å oppdage endrede data, aldri til å binde identitet. */
export interface PreviewTarget {
  rawMaterialId: string;
  name: string | null;
  baseUnit: string | null;
  origin: "forslag" | "kvittering" | "feilet";
}

export type PreviewState =
  | { status: "closed" }
  | { status: "loading"; target: PreviewTarget }
  | { status: "busy"; target: PreviewTarget }
  | { status: "ok"; target: PreviewTarget; preview: SinglePreview }
  | { status: "changed"; target: PreviewTarget }
  | { status: "unavailable"; target: PreviewTarget; reason: "server" | "malformed" | "transport" | "access" };

/**
 * Eksplisitt, skrivebeskyttet enkeltvisning av serverens regnestykke (R192).
 * Én forespørsel om gangen (synkron lås), alltid `p_dry_run: true`, ingen begrunnelse eller overstyring.
 * Selskap+vare+generasjon fryses ved utsending; lukk, avmontering, selskaps- eller tilgangsbytte gjør sene svar ugyldige.
 * Rører ikke kostpris-hookens forslag, kvitteringer eller logg.
 */
export function useSingleRecalcPreview() {
  const { legalEntityId, canWrite, loading } = useRavarer();
  const invoice = useInvoiceAccess();
  const ready = !loading && canWrite && !!legalEntityId && !invoice.isLoading && invoice.data === true;
  const [state, setState] = useState<PreviewState>({ status: "closed" });
  const gen = useRef(0);
  const inFlight = useRef(false);
  // Identiteten til forespørselen som er på vei (for å ignorere dobbeltklikk på samme mål).
  const active = useRef<{ id: string; origin: PreviewTarget["origin"]; entity: string; gen: number } | null>(null);
  const live = useRef({ ready, entity: legalEntityId, mounted: true });
  live.current.ready = ready;
  live.current.entity = legalEntityId;

  // Selskaps- eller tilgangsbytte: skjul og ugyldiggjør alt som er på vei.
  useEffect(() => {
    gen.current += 1;
    setState({ status: "closed" });
  }, [legalEntityId, ready]);
  useEffect(() => {
    const l = live.current;
    l.mounted = true;
    return () => { l.mounted = false; gen.current += 1; };
  }, []);

  const close = useCallback(() => { gen.current += 1; setState({ status: "closed" }); }, []);

  const open = useCallback(async (target: PreviewTarget) => {
    const l = live.current;
    const a = active.current;
    // Samme mål, samme opphav og selskap mens den gyldige forespørselen fortsatt er på vei: ignorer uten ny generasjon.
    if (inFlight.current && a && a.gen === gen.current && a.id === target.rawMaterialId && a.origin === target.origin && a.entity === l.entity) return;
    gen.current += 1;
    const myGen = gen.current;
    if (!l.ready || !l.entity) { setState({ status: "unavailable", target, reason: "access" }); return; }
    if (inFlight.current) { setState({ status: "busy", target }); return; }
    const frozen = { entity: l.entity, id: target.rawMaterialId, gen: myGen };
    inFlight.current = true;
    active.current = { id: frozen.id, origin: target.origin, entity: frozen.entity, gen: myGen };
    setState({ status: "loading", target });
    let next: PreviewState;
    try {
      const { data, error } = await supabase.rpc("recalc_raw_material_cost", { p_raw_material_id: frozen.id, p_dry_run: true });
      if (error) next = { status: "unavailable", target, reason: "server" };
      else {
        const r = parseSingleRecalcPreview(data);
        if (r.kind === "ok") {
          const p = r.preview;
          const mismatch = (target.name != null && target.name !== p.rawMaterial) || (target.baseUnit != null && target.baseUnit !== p.baseUnit);
          next = mismatch ? { status: "changed", target } : { status: "ok", target, preview: p };
        } else next = { status: "unavailable", target, reason: r.kind === "server_error" ? "server" : "malformed" };
      }
    } catch (e) {
      console.error("enkelt regnestykke", e);
      next = { status: "unavailable", target, reason: "transport" };
    } finally {
      inFlight.current = false;
      active.current = null;
    }
    const now = live.current;
    if (!now.mounted || gen.current !== frozen.gen || !now.ready || now.entity !== frozen.entity) return;
    setState(next);
  }, []);

  return { state, open, close, ready };
}
