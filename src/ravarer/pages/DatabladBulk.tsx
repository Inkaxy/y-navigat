import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { PackageEditor } from "@/ravarer/editors/PackageEditor";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { recomputeRecipesDetailed } from "@/varer/lib/recomputeFanout";
import { BulkFileRow, type BulkRow, type MaterialOption } from "@/ravarer/components/datablad/BulkFileRow";
import { DatasheetReviewDialog, type ReviewTarget } from "@/ravarer/components/datablad/DatasheetReviewDialog";
import { isObj } from "@/fakturaer/lib/parseRpcJson";
import { OrphanCleanup } from "@/ravarer/components/datablad/OrphanCleanup";
import {
  MAX_BULK_FILES, PRESELECT_SCORE, applyBody, invokeErrorKind, parseApplyOutcome, parseCandidates, retryStage, reviewValid, safeForBulk, summarizeExtract,
  type BulkField, type ReviewedOp,
} from "@/ravarer/lib/datasheetBulk";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Kontekst en operasjon startet i. Hver ny sideeffekt etter en await krever at den fortsatt gjelder. */
interface OpCtx { gen: number; entity: string }
type BulkItem = { key: string; file: string; target: string; op: ReviewedOp };
/** Usikre operasjoner fra en forlatt kontekst (selskapsbytte/avmontering) — beholdes synlige. */
type Abandoned = { file: string; target: string; state: string };

/**
 * Verktøy: datablad-opplasting (R147–R154). Inntil 100 filer → opplasting, AI-uttrekk, matching og
 * GJENNOMGANG per fil mot valgt råvare. Ingen skriving før brukeren anvender en gjennomgått fil eller
 * bekrefter et frosset utvalg av gjennomgåtte filer.
 */
export default function DatabladBulk() {
  const embedded = useIsEmbedded();
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useRavarer();
  const { data: rmRows = [] } = useRawMaterials();
  const materials = useMemo<MaterialOption[]>(() => rmRows.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name, sku: r.sku ?? null })), [rmRows]);

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<(BulkItem[] & { ctx?: OpCtx }) | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [packageTarget, setPackageTarget] = useState<{ row: PackageWorklistRow; suggestion: { size: number | null; contentUnit: string | null } | null } | null>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [abandoned, setAbandoned] = useState<Abandoned[]>([]);
  const rowsRef = useRef<BulkRow[]>([]);
  rowsRef.current = rows;

  /** Monoton generasjon: ny opplasting, nytt selskap eller avmontering gjør alle eldre operasjoner foreldet. */
  const gen = useRef(0);
  /** Gjeldende kontekst, lest synkront før hver sideeffekt (aldri fra en gammel closure). */
  const live = useRef({ mounted: true, entity: legalEntityId ?? null, canWrite });
  live.current.entity = legalEntityId ?? null;
  live.current.canWrite = canWrite;
  /** Synkron lås for anvend (enkelt, samlet, etter opprettelse) — tas før første await. */
  const applyLock = useRef(false);
  /** Rader med pågående opplasting/uttrekk/matching (nytt forsøk kan ikke starte to ganger). */
  const rowLocks = useRef(new Set<string>());

  const alive = (op: OpCtx) => live.current.mounted && op.gen === gen.current && op.entity === live.current.entity && live.current.canWrite;
  const ctxNow = (): OpCtx | null => (legalEntityId && canWrite ? { gen: gen.current, entity: legalEntityId } : null);

  useEffect(() => {
    const l = live.current;
    l.mounted = true;
    return () => { l.mounted = false; gen.current += 1; };
  }, []);

  // Nytt selskap: ny generasjon, lukk alle dialoger; usikre utfall fra forrige selskap forblir synlige.
  useEffect(() => {
    const unsafe = rowsRef.current.filter((r) => r.applyState === "applying" || r.applyState === "unknown" || r.applyState === "partial");
    if (unsafe.length > 0) setAbandoned((prev) => [...prev, ...unsafe.map((r) => ({ file: r.file.name, target: r.candidates.find((c) => c.id === r.selectedRm)?.name ?? "råvare", state: r.applyState === "partial" ? "delvis anvendt" : "ukjent utfall" }))]);
    gen.current += 1;
    rowLocks.current.clear();
    setRows([]); setBatchId(null); setBulkConfirm(null); setCreateKey(null); setPackageTarget(null); setReviewKey(null);
  }, [legalEntityId]);

  // Tapt skrivetilgang: lukk skrivedialoger (pågående operasjoner stopper ved neste kontroll).
  useEffect(() => {
    if (canWrite) return;
    setBulkConfirm(null); setCreateKey(null); setPackageTarget(null); setReviewKey(null);
  }, [canWrite]);

  const processing = rows.some((r) => r.status === "pending" || r.status === "uploading" || r.status === "extracting" || r.status === "matching");
  const unapplied = rows.some((r) => r.status === "ready" && r.applyState !== "applied" && !!r.selectedRm);
  const guard = useUnsavedChangesGuard(processing || unapplied || applyBusy);

  const update = (g: number, key: string, patch: Partial<BulkRow>) => {
    if (g !== gen.current || !live.current.mounted) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const syncBatch = async (id: string | null, op: OpCtx, status?: "completed") => {
    if (!id || !alive(op)) return;
    const cur = rowsRef.current;
    const { error } = await supabase.from("datasheet_upload_batches").update({
      processed: cur.filter((r) => r.status === "ready").length,
      failed: cur.filter((r) => r.status === "error").length,
      status: status ?? "processing",
      // Tidsstempel (instant), ikke kalenderdato.
      ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    }).eq("id", id);
    if (error) console.error("[datablad:batch-status]", error);
  };

  const STALE = "stale";
  const matchStage = async (op: OpCtx, row: BulkRow, datasheetId: string) => {
    update(op.gen, row.key, { status: "matching", stage: "match", datasheet_id: datasheetId, error: undefined });
    if (!alive(op)) throw new Error(STALE);
    const { data: ds, error: dsErr } = await supabase.from("raw_material_datasheets").select("ai_extracted").eq("id", datasheetId).maybeSingle();
    if (dsErr) throw new Error("Kunne ikke lese AI-uttrekket");
    if (!alive(op)) throw new Error(STALE);
    const { data: match, error: matchErr } = await supabase.functions.invoke("match-datasheet-to-raw-material", { body: { datasheet_id: datasheetId } });
    if (matchErr) throw new Error(`Matching feilet: ${matchErr.message}`);
    const candidates = parseCandidates(match);
    const top = candidates[0];
    const ai = isObj(ds?.ai_extracted) ? ds.ai_extracted : {};
    update(op.gen, row.key, {
      status: "ready", stage: undefined, summary: summarizeExtract(ai), ai, candidates, reviewed: null,
      // Forhåndsvalg ved høy score — autoriserer ikke skriving.
      selectedRm: top && top.score >= PRESELECT_SCORE ? top.id : null, manualTarget: false, error: undefined,
    });
  };

  const processRow = async (op: OpCtx, row: BulkRow, batch: string | null, from: "upload" | "extract" | "match") => {
    if (rowLocks.current.has(row.key)) return;
    rowLocks.current.add(row.key);
    let path = row.storage_path;
    try {
      if (from === "upload" || !path) {
        if (!alive(op)) throw new Error(STALE);
        update(op.gen, row.key, { status: "uploading", stage: "upload", error: undefined });
        path = `${op.entity}/bulk/${batch}/${Date.now()}-${row.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error } = await supabase.storage.from("raw-material-datasheets").upload(path, row.file);
        if (error) throw new Error(`Opplasting feilet: ${error.message}`);
        update(op.gen, row.key, { storage_path: path });
      }
      let dsId = row.datasheet_id;
      if (from !== "match" || !dsId) {
        if (!alive(op)) throw new Error(STALE);
        update(op.gen, row.key, { status: "extracting", stage: "extract", error: undefined });
        const { data: ext, error } = await supabase.functions.invoke("extract-datasheet", { body: { file_path: path, batch_id: batch } });
        if (error) throw new Error(`AI-uttrekk feilet: ${error.message}`);
        const id = isObj(ext) && typeof ext.datasheet_id === "string" ? ext.datasheet_id : null;
        if (!id) throw new Error("AI-uttrekk: serveren returnerte ikke datablad");
        dsId = id;
        update(op.gen, row.key, { datasheet_id: id });
      }
      if (!dsId) throw new Error("Mangler datablad");
      await matchStage(op, { ...row, storage_path: path }, dsId);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === STALE) return;
      console.error(`[datablad] ${row.file.name}:`, e);
      update(op.gen, row.key, { status: "error", error: errText(e) });
    } finally {
      rowLocks.current.delete(row.key);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || !canWrite || !legalEntityId) return;
    if (files.length > MAX_BULK_FILES) {
      toast.error(`Du valgte ${files.length} filer. Maks ${MAX_BULK_FILES} per opplasting — velg færre.`);
      return;
    }
    const op: OpCtx = { gen: ++gen.current, entity: legalEntityId };
    const fresh: BulkRow[] = files.map((file, i) => ({
      key: `${op.gen}-${i}`, file, status: "pending", candidates: [], selectedRm: null, manualTarget: false, applyState: "idle", followUps: [], packageSuggestion: null,
    }));
    setRows(fresh);
    const { data: batch, error } = await supabase.from("datasheet_upload_batches").insert({ legal_entity_id: op.entity, total_files: files.length }).select("id").single();
    if (!alive(op)) return;
    if (error || !batch?.id) {
      toast.error("Kunne ikke starte opplastingen. Ingen filer er lastet opp.");
      setRows([]);
      return;
    }
    setBatchId(batch.id);
    for (const r of fresh) {
      if (!alive(op)) return;
      await processRow(op, r, batch.id, "upload");
      await syncBatch(batch.id, op);
    }
    await syncBatch(batch.id, op, "completed");
  };

  const retry = async (key: string) => {
    const r = rowsRef.current.find((x) => x.key === key);
    const op = ctxNow();
    if (!r || !op) return;
    await processRow(op, r, batchId, retryStage(r));
    await syncBatch(batchId, op);
  };

  /** Knytter + anvender én fil med en FROSSET, gjennomgått operasjon. Returnerer utfallet. */
  const applyOne = async (key: string, reviewed: ReviewedOp): Promise<"applied" | "partial" | "failed" | "unknown" | "skipped"> => {
    const op: OpCtx = { gen: reviewed.gen, entity: reviewed.entity };
    if (!alive(op)) return "skipped";
    update(op.gen, key, { applyState: "applying", applyError: undefined, applyFailures: undefined });
    let linked = false;
    try {
      const { error: linkErr } = await supabase.from("raw_material_datasheets").update({ raw_material_id: reviewed.rmId }).eq("id", reviewed.datasheetId).eq("legal_entity_id", reviewed.entity);
      if (linkErr) throw new Error("Kunne ikke knytte databladet til råvaren");
      linked = true;
      // Ny sideeffekt etter await: konteksten må fortsatt gjelde.
      if (!alive(op)) {
        update(op.gen, key, { applyState: "unknown", applyError: "avbrutt etter kobling — ikke anvendt", reviewed: null });
        return "unknown";
      }
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", { body: applyBody(reviewed) });
      invalidateRawMaterial(qc, reviewed.rmId);
      void qc.invalidateQueries({ queryKey: ["nutrition-coverage"] });
      void qc.invalidateQueries({ queryKey: ["raw-material-changelog"] });
      void qc.invalidateQueries({ queryKey: ["orphan-datasheets"] });
      if (error) {
        const kind = invokeErrorKind(error);
        update(op.gen, key, { applyState: kind, applyError: error.message, reviewed: kind === "unknown" ? null : reviewed });
        return kind;
      }
      const out = parseApplyOutcome(data);
      const followUps = out.allergenRemovalsSkipped.length > 0 ? [`allergenfjerning ikke utført (${out.allergenRemovalsSkipped.join(", ")}) — vurder på råvaren`] : [];
      update(op.gen, key, {
        applyState: out.kind, applyError: out.error ?? undefined, applyFailures: out.failures, followUps, packageSuggestion: out.packageSuggestion,
        // Delvis/ukjent: gjennomgangen må gjøres på nytt mot dagens verdier før nytt forsøk.
        reviewed: out.kind === "partial" || out.kind === "unknown" ? null : reviewed,
      });
      // Etterarbeid etter bekreftet (helt/delvis) lagring fullføres for den frosne råvaren også om
      // brukeren navigerer; utfallet rapporteres separat. Ukjent utfall: ingen etterarbeid før gjennomgang.
      if (out.kind === "applied" || out.kind === "partial") void runRecompute(op.gen, key, reviewed.rmId);
      return out.kind;
    } catch (e: unknown) {
      console.error("[datablad:anvend]", e);
      update(op.gen, key, { applyState: linked ? "unknown" : "failed", applyError: errText(e), reviewed: linked ? null : reviewed });
      return linked ? "unknown" : "failed";
    }
  };

  const recomputing = useRef(new Set<string>());
  /** Etterberegning for frosset råvare-ID. Aldri en ny anvendelse; dobbel start for samme rad avvises. */
  const runRecompute = async (g: number, key: string, rmId: string) => {
    if (recomputing.current.has(key)) return;
    recomputing.current.add(key);
    const label = materials.find((m) => m.id === rmId)?.name ?? "råvaren";
    update(g, key, { recompute: { state: "running", ok: 0, total: 0, rmId } });
    try {
      const r = await recomputeRecipesDetailed(rmId, qc);
      if (g === gen.current && live.current.mounted) update(g, key, { recompute: { state: r.status, ok: r.ok, total: r.total, rmId } });
      else if (r.status === "failed" || r.status === "partial") {
        // Raden finnes ikke lenger (byttet selskap/forlot siden): varsle eksplisitt, ikke stille.
        toast.warning(`Oppskrifter som bruker «${label}» ble ikke beregnet på nytt. Datablad-anvendelsen står; beregn oppskriftene fra råvaren.`);
      }
    } finally {
      recomputing.current.delete(key);
    }
  };

  /** Tar den synkrone låsen; false hvis en annen anvendelse pågår. */
  const lock = () => {
    if (applyLock.current) return false;
    applyLock.current = true;
    setApplyBusy(true);
    return true;
  };
  const unlock = () => {
    applyLock.current = false;
    if (live.current.mounted) setApplyBusy(false);
  };

  const confirmReview = async (fields: BulkField[], nutritionFields: string[], mode: "apply" | "mark") => {
    const key = reviewKey;
    const r = rowsRef.current.find((x) => x.key === key);
    const op = ctxNow();
    if (!key || !r?.datasheet_id || !r.selectedRm || !op) return;
    const reviewed: ReviewedOp = { entity: op.entity, gen: op.gen, datasheetId: r.datasheet_id, rmId: r.selectedRm, fields: [...fields], nutritionFields: [...nutritionFields] };
    update(op.gen, key, { reviewed });
    if (mode === "mark") { setReviewKey(null); return; }
    if (!lock()) return;
    try { await applyOne(key, reviewed); } finally { unlock(); if (live.current.mounted) setReviewKey(null); }
  };

  const openBulk = () => {
    const op = ctxNow();
    if (!op) return;
    const nameOf = (r: BulkRow) => r.candidates.find((c) => c.id === r.selectedRm)?.name ?? "råvare";
    const snap = rowsRef.current.filter((r) => safeForBulk(r, op.entity, op.gen)).flatMap((r) => (r.reviewed ? [{ key: r.key, file: r.file.name, target: nameOf(r), op: r.reviewed }] : []));
    if (snap.length === 0) { toast.info("Ingen gjennomgåtte filer er trygge for samlet bekreftelse. Gjennomgå filene, eller anvend dem enkeltvis."); return; }
    setBulkConfirm(Object.assign(snap, { ctx: op }));
  };

  const runBulk = async () => {
    const snap = bulkConfirm;
    setBulkConfirm(null);
    if (!snap?.ctx || !alive(snap.ctx) || !lock()) return;
    setProgress({ done: 0, total: snap.length });
    const tally = { applied: 0, partial: 0, unknown: 0, failed: 0, skipped: 0 };
    try {
      for (let n = 0; n < snap.length; n++) {
        if (!alive(snap.ctx)) { tally.skipped += snap.length - n; break; }
        tally[await applyOne(snap[n].key, snap[n].op)]++;
        if (live.current.mounted) setProgress({ done: n + 1, total: snap.length });
      }
    } finally { unlock(); }
    if (!live.current.mounted) return;
    if (tally.applied === snap.length) toast.success(`${tally.applied} datablad anvendt`);
    else toast.warning(`${tally.applied} av ${snap.length} anvendt${tally.partial ? ` · ${tally.partial} delvis` : ""}${tally.unknown ? ` · ${tally.unknown} ukjent utfall` : ""}${tally.failed ? ` · ${tally.failed} avvist` : ""}${tally.skipped ? ` · ${tally.skipped} ikke startet` : ""}`);
  };

  const openPackage = async (key: string) => {
    const r = rowsRef.current.find((x) => x.key === key);
    const op = ctxNow();
    if (!r?.selectedRm || !op) return;
    const { data, error } = await supabase.from("raw_materials").select("id, legal_entity_id, name, base_unit, category, current_cost_price").eq("id", r.selectedRm).maybeSingle();
    // Sent svar etter bytte/avmontering/tapt tilgang åpner ingen dialog.
    if (!alive(op)) return;
    if (error || !data || data.legal_entity_id !== op.entity) { toast.error("Kunne ikke hente råvaren"); return; }
    setPackageTarget({
      row: {
        id: data.id, legal_entity_id: data.legal_entity_id, name: data.name, base_unit: data.base_unit, category: data.category ?? null, current_cost_price: data.current_cost_price ?? null,
        pakningsfaktor: null, faktor_kilde: null, bekreftet_dato: null, antall_fakturalinjer: null, antall_leverandorer: null, enheter_i_bruk: null,
        linjer_uten_pris: null, kjopt_kr_totalt: null, siste_faktura: null, pris_spredning: null, implisert_mengde: null, referansepris: null,
        referansekilde: null, referansedato: null, referanse_faktor: null,
      } as PackageWorklistRow,
      suggestion: r.packageSuggestion ? { size: r.packageSuggestion.size, contentUnit: r.packageSuggestion.unit } : null,
    });
  };

  const createRow = rows.find((r) => r.key === createKey) ?? null;
  const reviewRow = rows.find((r) => r.key === reviewKey) ?? null;
  const reviewTarget: ReviewTarget | null = reviewRow?.selectedRm && reviewRow.datasheet_id ? {
    key: reviewRow.key, fileName: reviewRow.file.name, storagePath: reviewRow.storage_path ?? null, ai: reviewRow.ai ?? {}, rmId: reviewRow.selectedRm,
    targetName: reviewRow.candidates.find((c) => c.id === reviewRow.selectedRm)?.name ?? materials.find((m) => m.id === reviewRow.selectedRm)?.name ?? "råvare",
  } : null;
  const counts = {
    ready: rows.filter((r) => r.status === "ready").length,
    applied: rows.filter((r) => r.applyState === "applied").length,
    failed: rows.filter((r) => r.status === "error" || r.applyState === "failed" || r.applyState === "partial" || r.applyState === "unknown").length,
  };

  return (
    <div className="space-y-4">
      <UnsavedChangesDialog {...guard.dialogProps} />
      <div>
        {!embedded && <h1 className="text-2xl font-semibold tracking-tight">Last opp datablad</h1>}
        <p className="text-caption text-ink-secondary">Last opp inntil {MAX_BULK_FILES} datablad. AI foreslår råvare; du gjennomgår dagens og nye verdier og anvender hver fil.</p>
      </div>

      {abandoned.length > 0 && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p className="font-medium">Usikre utfall fra forrige økt — kontroller råvarene:</p>
          <ul className="list-disc pl-5">{abandoned.map((a, i) => <li key={i} className="[overflow-wrap:anywhere]">{a.file} → {a.target}: {a.state}</li>)}</ul>
          <Button size="sm" variant="ghost" className="min-h-[44px] md:min-h-0" onClick={() => setAbandoned([])}>Skjul</Button>
        </div>
      )}

      {rows.length === 0 && (canWrite ? (
        <Card className="border-2 border-dashed p-8 text-center md:p-12">
          <Upload className="mx-auto mb-3 h-10 w-10 text-ink-secondary" aria-hidden />
          <input id="bulk" type="file" multiple accept="application/pdf,image/*" className="sr-only" onChange={(e) => void onPick(e)} />
          <label htmlFor="bulk"><Button asChild className="min-h-[44px]"><span className="cursor-pointer">Velg filer (maks {MAX_BULK_FILES})</span></Button></label>
        </Card>
      ) : <p className="text-sm text-ink-secondary">Du har lesetilgang. Opplasting krever skrivetilgang.</p>)}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-secondary" role="status">
              {rows.length} filer · {counts.ready} lest · {counts.applied} anvendt · {counts.failed} med feil/usikre{processing ? " · behandler…" : ""}
            </p>
            {canWrite && (
              <Button variant="outline" size="sm" className="min-h-[44px] md:min-h-0 md:h-9" onClick={openBulk} disabled={applyBusy || processing}>
                {applyBusy && progress.total > 0 ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />Anvender {progress.done} av {progress.total}…</> : "Bekreft alle gjennomgåtte trygge treff…"}
              </Button>
            )}
          </div>
          <Card><ul className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <BulkFileRow
                key={r.key} row={r} canWrite={canWrite} locked={applyBusy} materials={materials}
                reviewedOk={reviewValid(r, legalEntityId ?? null, gen.current)}
                onSelect={(id, manual) => { if (!applyLock.current) update(gen.current, r.key, { selectedRm: id, manualTarget: manual, reviewed: null, applyError: undefined, applyState: r.applyState === "failed" ? "idle" : r.applyState }); }}
                onReview={() => { if (!applyLock.current && canWrite) setReviewKey(r.key); }}
                onRetry={() => void retry(r.key)}
                onCreate={() => setCreateKey(r.key)}
                onOpenPackage={() => void openPackage(r.key)}
                onRetryRecompute={r.recompute && canWrite ? () => { const rc = r.recompute; if (rc) void runRecompute(gen.current, r.key, rc.rmId); } : undefined}
              />
            ))}
          </ul></Card>
        </>
      )}

      <OrphanCleanup legalEntityId={legalEntityId ?? null} canWrite={canWrite} />

      <DatasheetReviewDialog target={reviewTarget} canWrite={canWrite} busy={applyBusy} onClose={() => setReviewKey(null)} onConfirm={(f, n, m) => void confirmReview(f, n, m)} />

      <AlertDialog open={!!bulkConfirm} onOpenChange={(v) => { if (!v) setBulkConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anvende {bulkConfirm?.length} datablad?</AlertDialogTitle>
            <AlertDialogDescription>Bare gjennomgåtte filer der valgt mål er toppkandidaten med høy tillit. Hver fil skriver nøyaktig feltene du valgte i gjennomgangen. Pakning skrives ikke.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 overflow-y-auto text-sm" aria-label="Filer som anvendes">
            {bulkConfirm?.map((b) => <li key={b.key} className="truncate">{b.file} → <span className="font-medium">{b.target}</span> ({b.op.fields.length} felt)</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runBulk()}>Anvend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PackageEditor row={packageTarget?.row ?? null} open={packageTarget !== null} onOpenChange={(v) => { if (!v) setPackageTarget(null); }} suggestion={packageTarget?.suggestion ?? null} />

      {createRow?.datasheet_id && (
        <RawMaterialCreateSheet
          open
          onOpenChange={(v) => { if (!v) setCreateKey(null); }}
          context={{ kind: "datasheet", datasheetId: createRow.datasheet_id, fileName: createRow.file.name, aiFields: { name: createRow.summary?.name ?? undefined, supplier_name: createRow.summary?.supplier ?? undefined } }}
          onDone={(rmId) => {
            const key = createRow.key;
            setCreateKey(null);
            if (!rmId) return;
            // Ny råvare er opprettet: målet låses til den, og filen gjennomgås mot den før anvend — ingen ny råvare ved nytt forsøk.
            update(gen.current, key, { candidates: [{ id: rmId, name: createRow.summary?.name ?? "Ny råvare", sku: "", score: 1 }], selectedRm: rmId, manualTarget: true, reviewed: null });
            if (live.current.canWrite) setReviewKey(key);
          }}
          onUseExisting={(rmId) => {
            const key = createRow.key;
            setCreateKey(null);
            update(gen.current, key, { selectedRm: rmId, manualTarget: true, reviewed: null });
          }}
        />
      )}
    </div>
  );
}
