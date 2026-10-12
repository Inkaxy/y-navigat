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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllCounted } from "@/lib/countedPaging";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { chunkRawMaterialIds, isNonFatalPermissionError, MAX_RECALC_BATCH_SIZE } from "@/ravarer/lib/recalcBatch";
import { parseRecalcEnvelope, parseUndoEnvelope, type RecalcOkItem } from "@/ravarer/lib/recalcContract";
import {
  EMPTY_LEDGER, acknowledgeUndoUnknown, acknowledgeUnknownApply, addAppliedBatch, addUnknownApply, applyUndoResult, closeBatch,
  isKnownRecalcRejection, markUndoUnknown, outstanding, unresolvedIds, type RecalcLedger,
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

/** Blokkert kjøring: valgte varer har uavklart utfall som må kontrolleres eksplisitt først. */
export type ApplyBlock = { blockedIds: string[] };

/**
 * Fanehukommelse per selskap: kvitteringer, uavklarte utfall og siste sammendrag lever under
 * det frosne selskapet de ble skrevet for, og vises bare når det selskapet er gjeldende.
 */
/** Skriving som er sendt/reservert og ikke avklart ennå — eies av operasjonen som tok den. */
export type PendingWrite = { opId: number; kind: "apply" | "undo"; rawMaterialIds: string[] };
type EntityMemory = { ledger: RecalcLedger; summary: ApplySummary | null; pending: PendingWrite[] };
const memory = new Map<string, EntityMemory>();
const listeners = new Set<() => void>();
let storeVersion = 0;
/** Fane-unik operasjons-ID: nullstilles aldri ved montering. */
let nextOpId = 0;
function notify() { storeVersion += 1; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const getVersion = () => storeVersion;
function mem(entity: string): EntityMemory {
  let m = memory.get(entity);
  if (!m) { m = { ledger: EMPTY_LEDGER, summary: null, pending: [] }; memory.set(entity, m); }
  return m;
}
/** Skriver alltid til det FROSNE selskapets minne og varsler alle monterte eiere. */
function commit(entity: string, fn: (l: RecalcLedger) => RecalcLedger) { const m = mem(entity); m.ledger = fn(m.ledger); notify(); }
function pendingIds(entity: string): Set<string> {
  const out = new Set<string>();
  for (const p of mem(entity).pending) p.rawMaterialIds.forEach((id) => out.add(id));
  return out;
}
/** Bare eieren (opId) kan endre/slippe sin reservasjon. */
function setPending(entity: string, opId: number, ids: string[] | null) {
  const m = mem(entity);
  m.pending = m.pending.flatMap((p) => (p.opId !== opId ? [p] : ids && ids.length > 0 ? [{ ...p, rawMaterialIds: ids }] : []));
  notify();
}
/** Kun for tester. */
export function __resetCostRecalcMemory() { memory.clear(); notify(); }

interface MaterialRow { id: string; name: string; sku: string | null; base_unit: string | null; current_cost_price: number | null }

const IDLE: RecalcProgress = { phase: "idle", done: 0, total: 0, label: "" };

export function bucketOf(p: RecalcOkItem | null): RecalcBucket {
  if (!p) return "feilet";
  if (p.linesChanged > 0) return "endres";
  if (p.linesUnknown > 0) return "usikker";
  return "uendret";
}

export function useCostRecalc() {
  const { legalEntityId, canWrite, loading } = useRavarer();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{ entity: string; rows: RecalcRow[] } | null>(null);
  const [progress, setProgress] = useState<RecalcProgress>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "scan" | "apply" | "undo">(null);

  const op = useRef<null | "scan" | "apply" | "undo">(null);
  const opSeq = useRef(-1);
  const cancelRef = useRef(false);
  const live = useRef({ entity: legalEntityId, canWrite, loading, mounted: true });
  live.current.entity = legalEntityId;
  live.current.canWrite = canWrite;
  live.current.loading = loading;
  useEffect(() => {
    const l = live.current;
    l.mounted = true;
    return () => { l.mounted = false; };
  }, []);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const ownsWrite = useCallback(() => live.current.mounted && !live.current.loading && live.current.canWrite && !!live.current.entity, []);

  /**
   * Synkron inngang: montert, ferdig lastet tilgang, skriverett (alle RPC-ene krever rm_can_write).
   * Skrivinger reserverer varene i fanehukommelsen FØR kallet, så en remontert side ikke kan dobbeltskrive.
   */
  const begin = useCallback((kind: "scan" | "apply" | "undo", reserve?: string[]): { entity: string; id: number } | null => {
    if (op.current || !ownsWrite()) return null;
    const entity = live.current.entity as string;
    const id = ++nextOpId;
    op.current = kind; opSeq.current = id; cancelRef.current = false;
    if (reserve && kind !== "scan") { mem(entity).pending.push({ opId: id, kind, rawMaterialIds: [...reserve] }); notify(); }
    setBusy(kind); setError(null);
    return { entity, id };
  }, [ownsWrite]);
  const end = useCallback(() => { op.current = null; if (live.current.mounted) setBusy(null); }, []);
  const stillOwns = useCallback((f: { entity: string; id: number }) =>
    ownsWrite() && live.current.entity === f.entity && opSeq.current === f.id, [ownsWrite]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const scan = useCallback(async () => {
    const f = begin("scan");
    if (!f) return;
    setPreview(null);
    setProgress({ phase: "laster", done: 0, total: 0, label: "Henter råvarer …" });
    try {
      // Eksakt antall + keyset: en kort side (servertak) betyr ikke at alle varer er med.
      const materials = await fetchAllCounted<MaterialRow>({
        count: () => supabase.from("raw_materials").select("id", { count: "exact", head: true }).eq("legal_entity_id", f.entity).eq("is_active", true),
        page: (after, size) => {
          let q = supabase.from("raw_materials").select("id, name, sku, base_unit, current_cost_price")
            .eq("legal_entity_id", f.entity).eq("is_active", true).order("id", { ascending: true }).limit(size);
          if (after) q = q.gt("id", after);
          return q;
        },
      });
      if (!stillOwns(f)) return;
      const byId = new Map(materials.map((m) => [m.id, m]));
      const chunks = chunkRawMaterialIds(materials.map((m) => m.id), MAX_RECALC_BATCH_SIZE);
      const out: RecalcRow[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (!stillOwns(f)) return;
        if (cancelRef.current) { setProgress({ phase: "avbrutt", done: out.length, total: materials.length, label: "Avbrutt — forslaget er ufullstendig og vises ikke" }); return; }
        setProgress({ phase: "beregner", done: out.length, total: materials.length, label: `Serveren beregner forslag … ${out.length} av ${materials.length}` });
        const { data, error: err } = await supabase.rpc("recalc_raw_material_costs", { p_raw_material_ids: chunks[i], p_reason: "Forhåndsvisning av reberegning", p_dry_run: true });
        if (!stillOwns(f)) return;
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
      setPreview({ entity: f.entity, rows: out });
      setProgress({ phase: "ferdig", done: out.length, total: out.length, label: `${out.length} råvarer vurdert av serveren` });
    } catch (e) {
      const msg = e instanceof Error && !e.message.startsWith("Ufullstendig") ? e.message : "Råvarelisten kunne ikke hentes komplett. Forslaget vises ikke.";
      if (live.current.mounted) { setError(msg); setProgress(IDLE); }
    } finally {
      end();
    }
  }, [begin, end, stillOwns]);

  const apply = useCallback(async (ids: readonly string[]): Promise<ApplyBlock | void> => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const entity = live.current.entity;
    if (!entity) return;
    // Uavklart utfall for samme vare: aldri ny skriving før eksplisitt kontroll.
    const unresolved = unresolvedIds(mem(entity).ledger);
    const pend = pendingIds(entity);
    const blockedIds = unique.filter((id) => unresolved.has(id) || pend.has(id));
    if (blockedIds.length > 0) {
      if (live.current.mounted) setError(blockedIds.some((id) => pend.has(id))
        ? "Noen valgte råvarer har en skriving som ennå ikke er avklart. Vent til den er ferdig."
        : "Noen valgte råvarer har uavklart utfall fra en tidligere kjøring. Kontroller og bekreft dem før du kjører igjen.");
      return { blockedIds };
    }
    const f = begin("apply", unique);
    if (!f) return;
    const chunks = chunkRawMaterialIds(unique, APPLY_CHUNK);
    const s: ApplySummary = { requested: unique.length, succeeded: 0, failed: 0, linesChanged: 0, unknownIds: [], notStartedIds: [], stopped: null, statsRefreshed: null };
    mem(f.entity).summary = null; notify();
    setProgress({ phase: "skriver", done: 0, total: unique.length, label: `Reberegner … 0 av ${unique.length}` });
    let i = 0;
    try {
      for (; i < chunks.length; i++) {
        if (cancelRef.current) { s.stopped = "avbrutt"; break; }
        if (!stillOwns(f)) { s.stopped = "kontekst"; break; }
        const chunk = chunks[i];
        let env = null;
        try {
          const { data, error: err } = await supabase.rpc("recalc_raw_material_costs", { p_raw_material_ids: chunk, p_reason: `Reberegning av kostpris (${unique.length} varer)`, p_dry_run: false });
          // Avvisning med SQL-kode er kjent avvist (ingenting skrevet i dette kallet).
          if (err && isKnownRecalcRejection(err)) { s.failed += chunk.length; setPending(f.entity, f.id, chunks.slice(i + 1).flat()); continue; }
          if (!err) env = parseRecalcEnvelope(data, { ids: chunk, dryRun: false });
        } catch { env = null; }
        if (!env) {
          // Sendt, men utfallet er ukjent: blir en eksplisitt gjenopprettingspost (skilt fra ikke-startede).
          // Ukjent: kan være skrevet. Beholdes for kontroll; ingen nye bolker startes.
          s.unknownIds.push(...chunk);
          commit(f.entity, (l) => addUnknownApply(l, { opId: f.id, rawMaterialIds: chunk }));
          setPending(f.entity, f.id, chunks.slice(i + 1).flat());
          s.stopped = "ukjent";
          i++;
          break;
        }
        const confirmed = env;
        commit(f.entity, (l) => addAppliedBatch(l, confirmed));
        setPending(f.entity, f.id, chunks.slice(i + 1).flat());
        s.succeeded += confirmed.succeeded; s.failed += confirmed.failed; s.linesChanged += confirmed.linesChanged;
        if (live.current.mounted) setProgress({ phase: "skriver", done: s.succeeded + s.failed, total: unique.length, label: `Reberegner … ${s.succeeded + s.failed} av ${unique.length}` });
      }
      s.notStartedIds = chunks.slice(i).flat();
      // Statistikk oppdateres bare i samme kontekst; ellers står den som ikke kjørt (null).
      if (s.succeeded > 0 && stillOwns(f) && !cancelRef.current) {
        try {
          const { error: rpcErr } = await supabase.rpc("refresh_purchase_stats");
          s.statsRefreshed = !rpcErr || isNonFatalPermissionError(rpcErr);
        } catch { s.statsRefreshed = false; }
      }
    } finally {
      if (s.succeeded > 0 || s.unknownIds.length > 0) invalidateRawMaterial(qc);
      mem(f.entity).summary = s;
      // Eieren slipper resten (ikke-startede bolker) etter avklaring; ukjente ligger som egne poster.
      setPending(f.entity, f.id, null);
      if (live.current.mounted && live.current.entity === f.entity) {
        setProgress({ phase: s.stopped === "avbrutt" ? "avbrutt" : "ferdig", done: s.succeeded + s.failed, total: unique.length, label: s.stopped ? "Stoppet" : "Ferdig" });
      }
      end();
    }
  }, [qc, begin, end, stillOwns]);

  const undoBatch = useCallback(async (batchId: string) => {
    const entity = live.current.entity;
    if (!entity) return;
    // Bare gjeldende selskaps kvitteringer kan angres herfra.
    const batch = mem(entity).ledger.batches.find((b) => b.batchId === batchId);
    if (!batch || outstanding(batch).length === 0 || batch.undoUnknown) return;
    // Symmetrisk: angring sperres når en av varene har uavklart/ventende skriving fra en annen operasjon.
    const own = outstanding(batch).map((i) => i.rawMaterialId);
    const unresolved = unresolvedIds(mem(entity).ledger);
    const pend = pendingIds(entity);
    if (own.some((id) => unresolved.has(id) || pend.has(id))) {
      if (live.current.mounted) setError("Angring er sperret: en av råvarene har en skriving med uavklart utfall. Kontroller og bekreft den først.");
      return;
    }
    const f = begin("undo", own);
    if (!f || f.entity !== entity) { if (f) end(); return; }
    setProgress({ phase: "angrer", done: 0, total: 1, label: "Angrer …" });
    try {
      let env = null;
      try {
        const { data, error: err } = await supabase.rpc("undo_raw_material_recalcs", { p_batch_id: batchId });
        if (err && isKnownRecalcRejection(err)) { if (live.current.mounted) setError("Angringen ble avvist. Ingenting er endret i kvitteringen."); return; }
        if (!err) env = parseUndoEnvelope(data, batchId);
      } catch { env = null; }
      if (!env) {
        commit(f.entity, (l) => markUndoUnknown(l, batchId));
        if (live.current.mounted) setError("Vi vet ikke om angringen ble utført. Kvitteringen er beholdt — kontroller råvarene før du prøver igjen.");
        return;
      }
      const confirmed = env;
      commit(f.entity, (l) => applyUndoResult(l, batchId, confirmed));
      if (confirmed.succeeded > 0) invalidateRawMaterial(qc);
    } finally {
      setPending(f.entity, f.id, null);
      if (live.current.mounted) setProgress(IDLE);
      end();
    }
  }, [qc, begin, end]);

  /** Nullstiller bare forhåndsvisningen; kvitteringer og uavklarte utfall beholdes. */
  const reset = useCallback(() => {
    if (op.current) return;
    setPreview(null); setError(null); setProgress(IDLE);
    const e = live.current.entity;
    if (e) { mem(e).summary = null; notify(); }
  }, []);

  /** Eksplisitt kontroll av ukjent kjøreutfall, bundet til gjeldende selskap. */
  const acknowledgeUnknown = useCallback((opId: number) => {
    const e = live.current.entity;
    if (!e || op.current || !live.current.mounted) return;
    commit(e, (l) => acknowledgeUnknownApply(l, opId));
  }, []);
  const acknowledgeUndo = useCallback((batchId: string) => {
    const e = live.current.entity;
    if (!e || op.current || !live.current.mounted) return;
    commit(e, (l) => acknowledgeUndoUnknown(l, batchId));
  }, []);
  /** Eksplisitt (etter bekreftelse i UI): fjern kvittering; angring herfra blir da umulig. */
  const dismissBatch = useCallback((batchId: string) => {
    const e = live.current.entity;
    if (!e || op.current || !live.current.mounted) return;
    commit(e, (l) => closeBatch(l, batchId));
  }, []);

  const current = legalEntityId ? memory.get(legalEntityId) : undefined;
  const ledger = current?.ledger ?? EMPTY_LEDGER;
  const summary = current?.summary ?? null;
  const pending = current?.pending ?? [];
  const rows = preview && preview.entity === legalEntityId ? preview.rows : null;
  const writeReady = !loading && canWrite && !!legalEntityId;
  return { rows, progress, summary, ledger, pending, error, busy, canWrite: writeReady, accessLoading: loading, scan, apply, undoBatch, cancel, reset, acknowledgeUnknown, acknowledgeUndo, dismissBatch };
}
