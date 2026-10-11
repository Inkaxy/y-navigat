import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useApplyMatvaretabellen } from "@/ravarer/hooks/useMatvaretabellen";

export interface PendingOverwrite {
  session: number;
  rawMaterialId: string;
  name: string;
  foodId: string;
  source: string;
}

/**
 * Felles koblingsflyt for «Koble til råvare» og «Bruk eksisterende» fra opprettelsesarket:
 * 1) sjekk eksisterende næringskilde, 2) ved annen kilde: krev eksplisitt «Overskriv»,
 * 3) BARE det bekreftede mål/matvare-paret sendes med force=true. Vanlig kobling er alltid force=false.
 * Hver åpning/matvare/selskap er en egen økt — sene kildesjekker etter lukk/bytte ignoreres.
 */
export function useNutritionLinkFlow(foodId: string | null, active: boolean, onLinked?: (rawMaterialId: string) => void) {
  const { canWrite, legalEntityId } = useRavarer();
  const apply = useApplyMatvaretabellen();
  const session = useRef(0);
  const [pending, setPending] = useState<PendingOverwrite | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [linkedNow, setLinkedNow] = useState<string[]>([]);

  // Ny økt ved åpning, ny matvare eller nytt selskap: tilstanden fra forrige økt gjelder ikke.
  useEffect(() => {
    session.current += 1;
    setPending(null);
    setCheckingId(null);
    setLinkedNow([]);
  }, [foodId, active, legalEntityId]);

  const link = useCallback(async (rawMaterialId: string, fid: string, force: boolean, s: number) => {
    if (!canWrite) return;
    try {
      await apply.mutateAsync({ rawMaterialId, foodId: fid, force });
      if (s !== session.current) return;
      setLinkedNow((prev) => (prev.includes(rawMaterialId) ? prev : [...prev, rawMaterialId]));
      onLinked?.(rawMaterialId);
    } catch (e: unknown) {
      // Hooken viser feilmeldingen; her logges den bare.
      console.error("[matvaretabellen:koble]", e);
    }
  }, [apply, canWrite, onLinked]);

  const choose = useCallback(async (rawMaterialId: string, name: string) => {
    if (!canWrite || !foodId) return;
    const s = session.current;
    const fid = foodId;
    setCheckingId(rawMaterialId);
    try {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("source, matvaretabellen_food_id")
        .eq("raw_material_id", rawMaterialId)
        .maybeSingle();
      if (error) throw error;
      if (s !== session.current) return; // sent svar etter lukk/bytte
      if (data && (data.matvaretabellen_food_id ?? null) !== fid) {
        setPending({ session: s, rawMaterialId, name, foodId: fid, source: data.source || "ukjent" });
        return;
      }
      await link(rawMaterialId, fid, false, s);
    } catch (e: unknown) {
      console.error("[matvaretabellen:kildesjekk]", e);
      if (s === session.current) toast.error("Kunne ikke sjekke eksisterende næringsdata. Prøv igjen.");
    } finally {
      if (s === session.current) setCheckingId(null);
    }
  }, [canWrite, foodId, link]);

  const confirmOverwrite = useCallback(async () => {
    const p = pending;
    setPending(null);
    if (!p || p.session !== session.current || p.foodId !== foodId) return;
    await link(p.rawMaterialId, p.foodId, true, p.session);
  }, [pending, foodId, link]);

  const cancelOverwrite = useCallback(() => setPending(null), []);

  return { pending, checkingId, linkedNow, choose, confirmOverwrite, cancelOverwrite, isApplying: apply.isPending, canWrite };
}
