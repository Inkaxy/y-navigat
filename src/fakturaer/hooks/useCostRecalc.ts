/**
 * Reberegning av kostpriser — tynn adapter over de eksakte live-RPC-ene.
 *
 * - Forhåndsvisning = serverens dry-run (`recalc_raw_material_costs`, p_dry_run=true) per vare:
 *   et foreløpig forslag med antall linjer som endres/er ukjente/utelatt. Ingen egen
 *   klientberegning, og `cost_after` er ikke en garanti for kostprisen som blir satt.
 * - Kjøring skriver i små bolker. Hver bekreftet bolk lagres straks i kvitteringene, også ved
 *   delvis feil, avbrudd eller ukjent senere bolk. Kontekst (selskap, rettighet, montert,
 *   operasjon) kontrolleres før HVER ny bolk. Ukjent utfall gjentas aldri automatisk.
 * - Angring leser serverens svar per post; bare bekreftet angrede poster fjernes som utestående.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { chunkRawMaterialIds, isNonFatalPermissionError, MAX_RECALC_BATCH_SIZE } from "@/ravarer/lib/recalcBatch";
import { parseRecalcEnvelope, parseUndoEnvelope, type RecalcOkItem } from "@/ravarer/lib/recalcContract";
import {
  EMPTY_LEDGER, acknowledgeUnknownApply, addAppliedBatch, addUnknownApply, applyUndoResult, closeBatch,
  markUndoUnknown, outstanding, type RecalcLedger,
} from "@/ravarer/lib/recalcLedger";

export const APPLY_CHUNK = 10;

export type RecalcBucket = "endres" | "usikker" | "uendret" | "feilet";

export interface RecalcRow {
  rawMaterialId: string;
  name: string;
  sku: string | null;
  baseUnit: string | null;
  currentPrice: number | null;
  /** Serverens foreløpige forslag nå (dry-run) — null når varen feilet. */
  proposal: RecalcOkItem | null;
  failure: string | null;
  bucket: RecalcBucket;
}

export interface RecalcProgress {
  phase: "idle" | "laster" | "beregner" | "skriver" | "angrer" | "ferdig" | "avbrutt";
  done: number;
  total: number;
  label: string;
}

/** Utfall av siste kjøring, fra serverens egne tall. */
export interface ApplySummary {
  requested: number;
  succeeded: number;
  failed: number;
  linesChanged: number;
  unknownIds: string[];
  notStartedIds: string[];
  stopped: null | "avbrutt" | "kontekst" | "ukjent";
  statsRefreshed: boolean | null;
}

interface MaterialRow { id: string; name: string; sku: string | null; base_unit: string | null; current_cost_price: number | null }

const IDLE: RecalcProgress = { phase: "idle", done: 0, total: 0, label: "" };

export function bucketOf(p: RecalcOkItem | null): RecalcBucket {
  if (!p) return "feilet";
  if (p.linesChanged > 0) return "endres";
  if (p.linesUnknown > 0) return "usikker";
  return "uendret";
}

export function useCostRecalc() {
  const { legalEntityId, canWrite } = useRavarer();
  const qc = useQueryClient();
  const [rows, setRows] = useState<RecalcRow[] | null>(null);
  const [progress, setProgress] = useState<RecalcProgress>(IDLE);
  const [summary, setSummary] = useState<ApplySummary | null>(null);
  const [ledger, setLedger] = useState<RecalcLedger>(EMPTY_LEDGER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "scan" | "apply" | "undo">(null);

  const op = useRef<null | "scan" | "apply" | "undo">(null);
  const opSeq = useRef(0);
  const cancelRef = useRef(false);
  const live = useRef({ entity: legalEntityId, canWrite, mounted: true });
  live.current.entity = legalEntityId;
  live.current.canWrite = canWrite;
  useEffect(() => {
    const l = live.current;
    l.mounted = true;
    return () => { l.mounted = false; };
  }, []);
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const commit = (fn: (l: RecalcLedger) => RecalcLedger) => {
    ledgerRef.current = fn(ledgerRef.current);
    if (live.current.mounted) setLedger(ledgerRef.current);
  };

  function begin(kind: "scan" | "apply" | "undo", needsWrite: boolean): { entity: string; id: number } | null {
    if (op.current) return null;
    const entity = live.current.entity;
    if (!entity || (needsWrite && !live.current.canWrite)) return null;
    op.current = kind; opSeq.current += 1; cancelRef.current = false;
    setBusy(kind); setError(null);
    return { entity, id: opSeq.current };
  }
  function end() { op.current = null; if (live.current.mounted) setBusy(null); }
  const stillOwns = (f: { entity: string; id: number }, needsWrite: boolean) =>
    live.current.mounted && live.current.entity === f.entity && opSeq.current === f.id && (!needsWrite || live.current.canWrite);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const scan = useCallback(async () => {
    const f = begin("scan", false);
    if (!f) return;
    setRows(null);
    setProgress({ phase: "laster", done: 0, total: 0, label: "Henter råvarer …" });
    try {
      const materials = await fetchAllRows<MaterialRow>((from, to) =>
        supabase.from("raw_materials").select("id, name, sku, base_unit, current_cost_price")
          .eq("legal_entity_id", f.entity).eq("is_active", true).order("id", { ascending: true }).range(from, to));
      if (!stillOwns(f, false)) return;
      const byId = new Map(materials.map((m) => [m.id, m]));
      const chunks = chunkRawMaterialIds(materials.map((m) => m.id), MAX_RECALC_BATCH_SIZE);
      const out: RecalcRow[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (cancelRef.current) { setProgress({ phase: "avbrutt", done: out.length, total: materials.length, label: "Avbrutt — forslaget er ufullstendig og vises ikke" }); return; }
        setProgress({ phase: "beregner", done: out.length, total: materials.length, label: `Serveren beregner forslag … ${out.length} av ${materials.length}` });
        const { data, error: err } = await supabase.rpc("recalc_raw_material_costs", { p_raw_material_ids: chunks[i], p_reason: "Forhåndsvisning av reberegning", p_dry_run: true });
        if (!stillOwns(f, false)) return;
        if (err) throw new Error("Forhåndsvisningen kunne ikke hentes.");
        const env = parseRecalcEnvelope(data, { ids: chunks[i], dryRun: true });
        if (!env) throw new Error("Forhåndsvisningen hadde et uventet svar.");
        for (const it of env.items) {
          const m = byId.get(it.rawMaterialId);
          const proposal = it.ok ? it : null;
          out.push({
            rawMaterialId: it.rawMaterialId,
            name: m?.name ?? (it.ok ? it.name : "Ukjent råvare"),
            sku: m?.sku ?? null,
            baseUnit: m?.base_unit ?? null,
            currentPrice: m?.current_cost_price ?? null,
            proposal,
            failure: it.ok ? null : it.message,
            bucket: bucketOf(proposal),
          });
        }
      }
      out.sort((a, b) => (b.proposal?.linesChanged ?? -1) - (a.proposal?.linesChanged ?? -1) || a.name.localeCompare(b.name, "nb"));
      setRows(out);
      setProgress({ phase: "ferdig", done: out.length, total: out.length, label: `${out.length} råvarer vurdert av serveren` });
    } catch (e) {
      if (live.current.mounted) { setError(e instanceof Error ? e.message : "Forhåndsvisningen feilet."); setProgress(IDLE); }
    } finally {
      end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback(async (ids: readonly string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const f = begin("apply", true);
    if (!f) return;
    const chunks = chunkRawMaterialIds(unique, APPLY_CHUNK);
    const s: ApplySummary = { requested: unique.length, succeeded: 0, failed: 0, linesChanged: 0, unknownIds: [], notStartedIds: [], stopped: null, statsRefreshed: null };
    setSummary(null);
    setProgress({ phase: "skriver", done: 0, total: unique.length, label: `Reberegner … 0 av ${unique.length}` });
    let i = 0;
    try {
      for (; i < chunks.length; i++) {
        if (cancelRef.current) { s.stopped = "avbrutt"; break; }
        if (!stillOwns(f, true)) { s.stopped = "kontekst"; break; }
        const chunk = chunks[i];
        let env = null;
        try {
          const { data, error: err } = await supabase.rpc("recalc_raw_material_costs", { p_raw_material_ids: chunk, p_reason: `Reberegning av kostpris (${unique.length} varer)`, p_dry_run: false });
          // Avvisning med SQL-kode er kjent avvist (ingenting skrevet i dette kallet).
          if (err && (err as { code?: string }).code) { s.failed += chunk.length; continue; }
          if (!err) env = parseRecalcEnvelope(data, { ids: chunk, dryRun: false });
        } catch { env = null; }
        if (!env) {
          // Ukjent: kan være skrevet. Beholdes for kontroll; ingen nye bolker startes.
          s.unknownIds.push(...chunk);
          commit((l) => addUnknownApply(l, { opId: f.id, rawMaterialIds: chunk }));
          s.stopped = "ukjent";
          i++;
          break;
        }
        const confirmed = env;
        commit((l) => addAppliedBatch(l, confirmed));
        s.succeeded += confirmed.succeeded; s.failed += confirmed.failed; s.linesChanged += confirmed.linesChanged;
        if (live.current.mounted) setProgress({ phase: "skriver", done: s.succeeded + s.failed, total: unique.length, label: `Reberegner … ${s.succeeded + s.failed} av ${unique.length}` });
      }
      s.notStartedIds = chunks.slice(i).flat();
      if (s.succeeded > 0) {
        try {
          const { error: rpcErr } = await supabase.rpc("refresh_purchase_stats");
          s.statsRefreshed = !rpcErr || isNonFatalPermissionError(rpcErr);
        } catch { s.statsRefreshed = false; }
      }
    } finally {
      if (s.succeeded > 0 || s.unknownIds.length > 0) invalidateRawMaterial(qc);
      if (live.current.mounted) {
        setSummary(s);
        setProgress({ phase: s.stopped === "avbrutt" ? "avbrutt" : "ferdig", done: s.succeeded + s.failed, total: unique.length, label: s.stopped ? "Stoppet" : "Ferdig" });
      }
      end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const undoBatch = useCallback(async (batchId: string) => {
    const batch = ledgerRef.current.batches.find((b) => b.batchId === batchId);
    if (!batch || outstanding(batch).length === 0) return;
    const f = begin("undo", true);
    if (!f) return;
    setProgress({ phase: "angrer", done: 0, total: 1, label: "Angrer …" });
    try {
      let env = null;
      try {
        const { data, error: err } = await supabase.rpc("undo_raw_material_recalcs", { p_batch_id: batchId });
        if (err && (err as { code?: string }).code) { if (live.current.mounted) setError("Angringen ble avvist. Ingenting er endret i kvitteringen."); return; }
        if (!err) env = parseUndoEnvelope(data, batchId);
      } catch { env = null; }
      if (!env) {
        commit((l) => markUndoUnknown(l, batchId));
        if (live.current.mounted) setError("Vi vet ikke om angringen ble utført. Kvitteringen er beholdt — kontroller råvarene før du prøver igjen.");
        return;
      }
      const confirmed = env;
      commit((l) => applyUndoResult(l, batchId, confirmed));
      if (confirmed.succeeded > 0) invalidateRawMaterial(qc);
    } finally {
      if (live.current.mounted) setProgress(IDLE);
      end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  /** Nullstiller bare forhåndsvisningen; kvitteringer og uavklarte utfall beholdes. */
  const reset = useCallback(() => {
    if (op.current) return;
    setRows(null); setSummary(null); setError(null); setProgress(IDLE);
  }, []);

  const acknowledgeUnknown = useCallback((opId: number) => commit((l) => acknowledgeUnknownApply(l, opId)), []);
  const dismissBatch = useCallback((batchId: string) => commit((l) => closeBatch(l, batchId)), []);

  return { rows, progress, summary, ledger, error, busy, canWrite, scan, apply, undoBatch, cancel, reset, acknowledgeUnknown, dismissBatch };
}
