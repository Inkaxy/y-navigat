import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { draftFrom, parseDraft, planIsEmpty, planSave, type CatRow, type PriceDraft, type SavePlan } from "@/ravarer/lib/priceSettingsDraft";

export interface SaveStep { label: string; ok: boolean }
export type SaveResult =
  | { kind: "saved" }
  /** Noen steg lyktes, andre feilet eller har ukjent utfall. Kladden for de feilede beholdes. */
  | { kind: "partial"; steps: SaveStep[]; reread: "ok" | "failed" }
  | { kind: "failed"; steps: SaveStep[]; reread: "ok" | "failed" }
  | { kind: "stale" };

const CAT_KEY = "match-tolerances";

/**
 * Kladdmodell for Priskontroll-innstillingene. `draft=null` betyr «følg serveren» (ren). Kladden er bundet
 * til selskapet og en revisjon; en bakgrunnslesing erstatter aldri en påbegynt kladd. Lagring fryser
 * selskap + revisjon + plan, låser feltene mens den pågår, og leser serveren på nytt etterpå: neste plan
 * regnes da fra faktisk lagret tilstand, så fullførte steg (også slettinger) gjentas aldri blindt.
 */
export function usePriceSettingsDraft(legalEntityId: string | null, canEdit: boolean) {
  const qc = useQueryClient();
  const tol = useMatchTolerances(legalEntityId);
  const rowsQuery = useQuery({
    queryKey: [CAT_KEY, legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<CatRow[]> => {
      const { data, error } = await supabase
        .from("invoice_match_category_tolerances")
        .select("id, category, price_tolerance_pct")
        .eq("legal_entity_id", legalEntityId!)
        .order("category")
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, category: r.category, price_tolerance_pct: Number(r.price_tolerance_pct) }));
    },
  });

  const [state, setState] = useState<{ entity: string; rev: number; value: PriceDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [needsReread, setNeedsReread] = useState(false);
  const busy = useRef(false);
  const live = useRef({ entity: legalEntityId, canEdit, mounted: true });
  live.current = { ...live.current, entity: legalEntityId, canEdit };
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);

  const loaded = tol.isLoaded && rowsQuery.isSuccess;
  const readError = tol.isError || rowsQuery.isError;
  const baseSettings = tol.settings;
  const baseRows = rowsQuery.data ?? null;
  const baseline = loaded && baseRows ? draftFrom(baseSettings, baseRows) : null;
  // En kladd fra et annet selskap vises aldri her.
  const scoped = state && state.entity === legalEntityId ? state : null;
  const draft = scoped?.value ?? baseline;
  const plan: SavePlan | null = loaded && draft && baseRows ? planSave(baseSettings, baseRows, draft) : null;
  const parsed = draft ? parseDraft(draft) : null;
  const errors = parsed && !parsed.ok ? parsed.errors : [];
  const dirty = !!scoped && (plan == null || !planIsEmpty(plan));

  const update = useCallback((patch: Partial<PriceDraft>) => {
    if (!legalEntityId || !baseline || busy.current) return;
    setResult(null);
    setState((cur) => {
      const curScoped = cur && cur.entity === legalEntityId ? cur : null;
      const value = { ...(curScoped?.value ?? baseline), ...patch };
      return { entity: legalEntityId, rev: (curScoped?.rev ?? 0) + 1, value };
    });
  }, [legalEntityId, baseline]);

  const cancel = useCallback(() => { if (!busy.current) { setState(null); setResult(null); } }, []);

  const reread = useCallback(async () => {
    const [a, b] = await Promise.all([tol.refetch(), rowsQuery.refetch()]);
    const ok = isOk(a) && isOk(b);
    if (ok && live.current.mounted) setNeedsReread(false);
    return ok;
  }, [tol, rowsQuery]);

  const save = useCallback(async () => {
    if (busy.current || !legalEntityId || !scoped || !plan || planIsEmpty(plan) || needsReread) return;
    if (!live.current.canEdit) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    const frozen = { entity: legalEntityId, rev: scoped.rev, plan };
    const steps: SaveStep[] = [];
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id ?? null;
      const run = async (label: string, op: () => PromiseLike<{ error: unknown }>) => {
        // Ingen ny skriving hvis tilgangen er tapt eller selskapet byttet underveis.
        if (!live.current.canEdit || live.current.entity !== frozen.entity) { steps.push({ label, ok: false }); return; }
        try {
          const { error } = await op();
          steps.push({ label, ok: !error });
        } catch (e) {
          console.warn("[innstillinger] lagringssteg: ukjent utfall", label, e);
          steps.push({ label, ok: false });
        }
      };
      if (frozen.plan.settings) {
        const payload = frozen.plan.settings;
        await run("Prisavvik, matching og startpris", () =>
          supabase.from("invoice_match_settings").upsert(
            { legal_entity_id: frozen.entity, ...payload, updated_at: new Date().toISOString(), updated_by: userId },
            { onConflict: "legal_entity_id" },
          ));
      }
      for (const u of frozen.plan.updates) {
        await run(`Kategoritoleranse «${u.category}»`, () =>
          supabase.from("invoice_match_category_tolerances").update({ price_tolerance_pct: u.pct }).eq("id", u.id).eq("legal_entity_id", frozen.entity));
      }
      for (const i of frozen.plan.inserts) {
        await run(`Ny kategoritoleranse «${i.category}»`, () =>
          supabase.from("invoice_match_category_tolerances").insert({ legal_entity_id: frozen.entity, category: i.category, price_tolerance_pct: i.pct }));
      }
      for (const d of frozen.plan.deletes) {
        await run(`Fjern kategoritoleranse «${d.category}»`, () =>
          supabase.from("invoice_match_category_tolerances").delete().eq("id", d.id).eq("legal_entity_id", frozen.entity));
      }
    } finally {
      // Les faktisk lagret tilstand for det frosne selskapet, uansett utfall.
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["invoice-match-tolerances"] });
      const rereadOk = live.current.entity === frozen.entity ? await reread() : false;
      if (live.current.entity !== frozen.entity) void qc.invalidateQueries({ queryKey: [CAT_KEY, frozen.entity] });
      busy.current = false;
      if (live.current.mounted) {
        setSaving(false);
        if (live.current.entity !== frozen.entity) setResult({ kind: "stale" });
        else {
          const allOk = steps.length > 0 && steps.every((s) => s.ok);
          if (!rereadOk) setNeedsReread(true);
          if (allOk && rereadOk) {
            setResult({ kind: "saved" });
            // Bare den innsendte revisjonen kvitteres (feltene var låst, så den er fortsatt gjeldende).
            setState((cur) => (cur && cur.entity === frozen.entity && cur.rev === frozen.rev ? null : cur));
          } else {
            const anyOk = steps.some((s) => s.ok);
            setResult({ kind: anyOk ? "partial" : "failed", steps, reread: rereadOk ? "ok" : "failed" });
          }
        }
      }
    }
  }, [legalEntityId, scoped, plan, needsReread, qc, reread]);

  return {
    status: readError ? ("error" as const) : loaded ? ("ready" as const) : ("loading" as const),
    readError: tol.isError ? tol.error : rowsQuery.error,
    retry: () => void reread(),
    settingsAbsent: loaded && baseSettings == null,
    draft,
    baseRows: baseRows ?? [],
    update,
    cancel,
    save: () => void save(),
    reread,
    dirty,
    errors,
    saving,
    result,
    needsReread,
    canSave: canEdit && dirty && errors.length === 0 && !saving && !needsReread && loaded,
  };
}

function isOk(r: unknown): boolean {
  return typeof r === "object" && r !== null && "isSuccess" in r && r.isSuccess === true;
}
