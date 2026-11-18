// «Nullstill køen» – status (lesing) og løperen som kjører stegene i bolker fra denne fanen.
// Tilstanden ligger på serveren (krav-token per steg), så omlasting eller to faner kan aldri kjøre samme steg to ganger.
// Pause/stopp gjelder fra neste bolk. Ukjent utfall blir «uavklart» og kontrolleres eksplisitt (aldri automatisk nytt kall).
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/hooks/useCompany";
import { useCapability } from "@/lib/pendingRpc";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import {
  addPhase2, checkItem, claim, completeRun, fetchCatalog, fetchRunSnapshot, fetchSnapshot, fetchStatus, finish, liveDeps, recover, rematchPending, undoMark,
} from "@/ravarer/lib/nullstilling/api";
import { executeStep } from "@/ravarer/lib/nullstilling/execute";
import { planPhase2 } from "@/ravarer/lib/nullstilling/plan";
import { fetchRunItems, undoItem } from "@/ravarer/lib/nullstilling/runItems";
import type { Rule } from "@/ravarer/lib/nullstilling/types";

export const RESET_STATUS_KEY = ["ravarer", "nullstilling", "status"] as const;
const REMATCH_WAIT_MS = 15 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useResetStatus(enabled = true) {
  const { data: company } = useCompany();
  const cap = useCapability("rm_cap_nullstill_koen_v1");
  const le = company?.id ?? null;
  const q = useQuery({
    queryKey: [...RESET_STATUS_KEY, le],
    enabled: enabled && !!le && cap === true,
    queryFn: () => fetchStatus(le!),
    refetchInterval: (s) => (s.state.data?.run && (s.state.data.run.status === "aktiv" || s.state.data.pendingClaims > 0) ? 5000 : false),
  });
  return { ...q, cap, le };
}

export type RunnerState = { running: boolean; note: string | null; error: string | null; done: number };

export function useResetRunner(runId: string | null) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const [state, setState] = useState<RunnerState>({ running: false, note: null, error: null, done: 0 });
  const lock = useRef(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; stop.current = true; }, []);
  const set = (p: Partial<RunnerState>) => { if (mounted.current) setState((s) => ({ ...s, ...p })); };
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: RESET_STATUS_KEY });
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
    void qc.invalidateQueries({ queryKey: ["raw_materials"] });
    invalidateRavarerCounts(qc);
  }, [qc]);

  /** Steg som sto «pågår» fra en tidligere økt blir uavklart etter fristen; deretter kontrolleres alle uavklarte (revisjonslogg/op-id). */
  const checkUnresolved = useCallback(async (staleSeconds = 180): Promise<number> => {
    if (!runId) return 0;
    await recover(runId, staleSeconds);
    const open = await fetchRunItems(runId, "status=eq.uavklart");
    for (const it of open) await checkItem(it.id);
    refresh();
    return open.length;
  }, [runId, refresh]);

  const planSecondPhase = useCallback(async (): Promise<boolean> => {
    if (!runId || !le) return false;
    const t0 = Date.now();
    for (;;) {
      const p = await rematchPending(le);
      if (p === 0) break;
      if (stop.current) return false;
      if (Date.now() - t0 > REMATCH_WAIT_MS) { set({ error: "Omregningen er ikke ferdig etter 15 minutter. Trykk «Fortsett» senere." }); return false; }
      set({ note: p == null ? "Venter på omregningen (status ukjent) …" : `Venter på at ${p.toLocaleString("nb-NO")} fakturaer regnes om før resten avsluttes …` });
      await sleep(10_000);
    }
    set({ note: "Leser det som fortsatt er åpent …" });
    const [lines, cat, snap] = await Promise.all([fetchSnapshot(le), fetchCatalog(le), fetchRunSnapshot(runId)]);
    const items = planPhase2(lines, snap, cat);
    const r = await addPhase2(runId, items);
    if (!r.ok) { set({ error: r.error === "koen_endret" ? "Noe ble endret mens fase 2 ble planlagt. Trykk «Fortsett» for å planlegge på nytt." : `Fase 2 ble avvist (${r.error}).` }); return false; }
    return true;
  }, [runId, le]);

  const run = useCallback(async () => {
    if (!runId || !le || lock.current) return;
    lock.current = true; stop.current = false;
    set({ running: true, error: null, note: "Kontrollerer steg fra tidligere økter …" });
    let done = 0;
    try {
      await checkUnresolved(180);
      for (;;) {
        if (stop.current) break;
        const c = await claim(runId, 3);
        if (c.status !== "aktiv") { set({ note: c.status === "pause" ? "Satt på pause." : null }); break; }
        if (c.items.length === 0) {
          const st = await fetchStatus(le);
          const left = st.counts.filter((x) => x.phase === c.phase && (x.status === "venter" || x.status === "pagar" || x.status === "uavklart"));
          if (left.some((x) => x.status === "uavklart")) { set({ error: "Noen steg har ukjent utfall. Kontroller dem før kjøringen fortsetter." }); break; }
          if (left.length > 0) { set({ note: "Venter på steg som pågår i en annen fane eller økt …" }); await sleep(15_000); await checkUnresolved(180); continue; }
          if (c.phase === 1) { if (!(await planSecondPhase())) break; continue; }
          set({ note: "Avslutter og setter status på fakturaene …" });
          const r = await completeRun(runId);
          if (!r.ok) set({ error: `Kunne ikke avslutte (${r.error}).` });
          break;
        }
        for (const it of c.items) {
          set({ note: `Steg ${it.seq} i fase ${it.phase}: ${it.payload.title || it.item_key || ""}` });
          const o = await executeStep(it, { le, runId }, liveDeps);
          const f = await finish(it.id, it.claim_token, o.status, o.result, o.error);
          if (!f || !f.ok) { set({ error: "Steget ble utført, men utfallet kunne ikke registreres. Det kontrolleres ved neste «Fortsett»." }); stop.current = true; break; }
          done++; set({ done });
          if (done % 20 === 0) refresh();
        }
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Ukjent feil. Trykk «Fortsett» for å kontrollere og fortsette." });
    } finally {
      lock.current = false;
      set({ running: false });
      refresh();
    }
  }, [runId, le, checkUnresolved, planSecondPhase, refresh]);

  const halt = useCallback(() => { stop.current = true; }, []);
  return { state, run, halt, checkUnresolved };
}

export type UndoProgress = { running: boolean; done: number; total: number; undone: number; partial: number; notPossible: number; unknown: number; error: string | null };

/** «Angre nullstilling» for hele kjøringen eller valgte regler, siste steg først. */
export function useResetUndo(runId: string | null) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const lock = useRef(false);
  const [p, setP] = useState<UndoProgress>({ running: false, done: 0, total: 0, undone: 0, partial: 0, notPossible: 0, unknown: 0, error: null });
  const undo = useCallback(async (rules: readonly Rule[], onlyIds?: readonly string[]) => {
    if (!runId || !le || lock.current) return;
    lock.current = true;
    const acc = { done: 0, undone: 0, partial: 0, notPossible: 0, unknown: 0 };
    setP({ running: true, total: 0, error: null, ...acc });
    try {
      const rows = (await fetchRunItems(runId, `status=eq.ferdig&or=(undo_status.is.null,undo_status.eq.delvis)&rule=in.(${rules.join(",")})`, "phase.desc,seq.desc"))
        .filter((r) => !onlyIds || onlyIds.includes(r.id));
      setP((s) => ({ ...s, total: rows.length }));
      for (const row of rows) {
        const o = await undoItem(le, runId, row);
        if (o.status === "ukjent") acc.unknown++;
        else {
          await undoMark(row.id, o.status, o.result);
          if (o.status === "angret") acc.undone++; else if (o.status === "delvis") acc.partial++; else acc.notPossible++;
        }
        acc.done++;
        setP((s) => ({ ...s, ...acc }));
      }
    } catch (e) {
      setP((s) => ({ ...s, error: e instanceof Error ? e.message : "Ukjent feil under angring." }));
    } finally {
      lock.current = false;
      setP((s) => ({ ...s, running: false }));
      void qc.invalidateQueries({ queryKey: RESET_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: ["ravarer", "nullstilling"] });
      void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
      invalidateRavarerCounts(qc);
    }
  }, [runId, le, qc]);
  return { progress: p, undo };
}
