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
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { PackageEditor } from "@/ravarer/editors/PackageEditor";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { recomputeRecipesForRawMaterial } from "@/varer/lib/recomputeFanout";
import { BulkFileRow, type BulkRow, type MaterialOption } from "@/ravarer/components/datablad/BulkFileRow";
import { OrphanCleanup } from "@/ravarer/components/datablad/OrphanCleanup";
import {
  BULK_FIELDS, MAX_BULK_FILES, PRESELECT_SCORE, parseApplyOutcome, parseCandidates, retryStage, safeForBulk, summarizeExtract,
} from "@/ravarer/lib/datasheetBulk";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Verktøy: datablad-opplasting (R147–R154). Inntil 100 filer → opplasting, AI-uttrekk, matching og
 * GJENNOMGANG per fil. Ingen skriving skjer før brukeren anvender en fil eller bekrefter et frosset utvalg.
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
  const [bulkConfirm, setBulkConfirm] = useState<{ key: string; file: string; target: string; rmId: string }[] | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [packageTarget, setPackageTarget] = useState<{ row: PackageWorklistRow; suggestion: { size: number | null; contentUnit: string | null } | null } | null>(null);
  const rowsRef = useRef<BulkRow[]>([]);
  rowsRef.current = rows;
  /** Ny generasjon ved ny opplasting eller annet selskap: sene svar fra forrige gjelder ikke. */
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; setRows([]); setBatchId(null); }, [legalEntityId]);

  const processing = rows.some((r) => r.status === "pending" || r.status === "uploading" || r.status === "extracting" || r.status === "matching");
  const unapplied = rows.some((r) => r.status === "ready" && r.applyState !== "applied" && !!r.selectedRm);
  const guard = useUnsavedChangesGuard(processing || unapplied || applyBusy);

  const update = (g: number, key: string, patch: Partial<BulkRow>) => {
    if (g !== gen.current) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const syncBatch = async (id: string | null, g: number, status?: "completed") => {
    if (!id || g !== gen.current) return;
    const cur = rowsRef.current;
    const { error } = await supabase.from("datasheet_upload_batches").update({
      processed: cur.filter((r) => r.status === "ready").length,
      failed: cur.filter((r) => r.status === "error").length,
      status: status ?? "processing",
      ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    }).eq("id", id);
    if (error) console.error("[datablad:batch-status]", error);
  };

  const matchStage = async (g: number, row: BulkRow, datasheetId: string) => {
    update(g, row.key, { status: "matching", stage: "match", datasheet_id: datasheetId, error: undefined });
    const { data: ds, error: dsErr } = await supabase.from("raw_material_datasheets").select("ai_extracted").eq("id", datasheetId).maybeSingle();
    if (dsErr) throw new Error("Kunne ikke lese AI-uttrekket");
    const { data: match, error: matchErr } = await supabase.functions.invoke("match-datasheet-to-raw-material", { body: { datasheet_id: datasheetId } });
    if (matchErr) throw new Error(`Matching feilet: ${matchErr.message}`);
    const candidates = parseCandidates(match);
    const top = candidates[0];
    update(g, row.key, {
      status: "ready", stage: undefined, summary: summarizeExtract(ds?.ai_extracted ?? null), candidates,
      // Forhåndsvalg ved høy score — autoriserer ikke skriving.
      selectedRm: top && top.score >= PRESELECT_SCORE ? top.id : null, manualTarget: false, error: undefined,
    });
  };

  const processRow = async (g: number, row: BulkRow, batch: string | null, from: "upload" | "extract" | "match") => {
    let path = row.storage_path;
    try {
      if (!legalEntityId) throw new Error("Mangler selskap");
      if (from === "upload" || !path) {
        update(g, row.key, { status: "uploading", stage: "upload", error: undefined });
        path = `${legalEntityId}/bulk/${batch}/${Date.now()}-${row.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error } = await supabase.storage.from("raw-material-datasheets").upload(path, row.file);
        if (error) throw new Error(`Opplasting feilet: ${error.message}`);
        update(g, row.key, { storage_path: path });
      }
      let dsId = row.datasheet_id;
      if (from !== "match" || !dsId) {
        update(g, row.key, { status: "extracting", stage: "extract", error: undefined });
        const { data: ext, error } = await supabase.functions.invoke("extract-datasheet", { body: { file_path: path, batch_id: batch } });
        if (error) throw new Error(`AI-uttrekk feilet: ${error.message}`);
        const id = ext && typeof ext === "object" && "datasheet_id" in ext && typeof ext.datasheet_id === "string" ? ext.datasheet_id : null;
        if (!id) throw new Error("AI-uttrekk: serveren returnerte ikke datablad");
        dsId = id;
      }
      await matchStage(g, { ...row, storage_path: path }, dsId);
    } catch (e: unknown) {
      console.error(`[datablad] ${row.file.name}:`, e);
      update(g, row.key, { status: "error", error: errText(e) });
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
    const g = ++gen.current;
    const fresh: BulkRow[] = files.map((file, i) => ({
      key: `${g}-${i}`, file, status: "pending", candidates: [], selectedRm: null, manualTarget: false, applyState: "idle", followUps: [], packageSuggestion: null,
    }));
    setRows(fresh);
    const { data: batch, error } = await supabase.from("datasheet_upload_batches").insert({ legal_entity_id: legalEntityId, total_files: files.length }).select("id").single();
    if (error || !batch?.id) {
      toast.error("Kunne ikke starte opplastingen. Ingen filer er lastet opp.");
      if (g === gen.current) setRows([]);
      return;
    }
    setBatchId(batch.id);
    for (const r of fresh) {
      if (g !== gen.current) return;
      await processRow(g, r, batch.id, "upload");
      await syncBatch(batch.id, g);
    }
    await syncBatch(batch.id, g, "completed");
  };

  const retry = async (key: string) => {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r || !canWrite) return;
    const g = gen.current;
    await processRow(g, r, batchId, retryStage(r));
    await syncBatch(batchId, g);
  };

  /** Knytter + anvender én fil med et FROSSET mål. Returnerer om alt ble lagret. */
  const applyOne = async (g: number, key: string, rmId: string): Promise<boolean> => {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r?.datasheet_id || !canWrite) return false;
    update(g, key, { applyState: "applying", applyError: undefined });
    try {
      const { error: linkErr } = await supabase.from("raw_material_datasheets").update({ raw_material_id: rmId }).eq("id", r.datasheet_id);
      if (linkErr) throw new Error("Kunne ikke knytte databladet til råvaren");
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", {
        body: { datasheet_id: r.datasheet_id, raw_material_id: rmId, accepted_fields: [...BULK_FIELDS] },
      });
      if (error) throw new Error(error.message);
      const out = parseApplyOutcome(data);
      const followUps = out.allergenRemovalsSkipped.length > 0 ? [`allergenfjerning ikke utført (${out.allergenRemovalsSkipped.join(", ")}) — vurder på råvaren`] : [];
      invalidateRawMaterial(qc, rmId);
      void qc.invalidateQueries({ queryKey: ["nutrition-coverage"] });
      void qc.invalidateQueries({ queryKey: ["raw-material-changelog"] });
      void qc.invalidateQueries({ queryKey: ["orphan-datasheets"] });
      void recomputeRecipesForRawMaterial(rmId, qc, { silent: true });
      if (!out.ok) {
        update(g, key, { applyState: "failed", applyError: out.error ?? `noe ble ikke lagret: ${out.failures.join(" · ")}`, followUps, packageSuggestion: out.packageSuggestion });
        return false;
      }
      update(g, key, { applyState: "applied", followUps, packageSuggestion: out.packageSuggestion });
      return true;
    } catch (e: unknown) {
      console.error("[datablad:anvend]", e);
      update(g, key, { applyState: "failed", applyError: errText(e) });
      return false;
    }
  };

  const applySingle = async (key: string) => {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r?.selectedRm || applyBusy) return;
    setApplyBusy(true);
    try { await applyOne(gen.current, key, r.selectedRm); } finally { setApplyBusy(false); }
  };

  const openBulk = () => {
    const nameOf = (r: BulkRow) => r.candidates.find((c) => c.id === r.selectedRm)?.name ?? "råvare";
    const snap = rowsRef.current.filter(safeForBulk).flatMap((r) => (r.selectedRm ? [{ key: r.key, file: r.file.name, target: nameOf(r), rmId: r.selectedRm }] : []));
    if (snap.length === 0) { toast.info("Ingen filer er trygge for samlet bekreftelse. Anvend dem enkeltvis."); return; }
    setBulkConfirm(snap);
  };

  const runBulk = async () => {
    const snap = bulkConfirm;
    setBulkConfirm(null);
    if (!snap || applyBusy || !canWrite) return;
    const g = gen.current;
    setApplyBusy(true);
    setProgress({ done: 0, total: snap.length });
    let ok = 0;
    try {
      for (let n = 0; n < snap.length; n++) {
        if (await applyOne(g, snap[n].key, snap[n].rmId)) ok++;
        setProgress({ done: n + 1, total: snap.length });
      }
    } finally { setApplyBusy(false); }
    if (ok === snap.length) toast.success(`${ok} datablad anvendt`);
    else toast.warning(`${ok} av ${snap.length} anvendt — se filene merket «Ikke anvendt»`);
  };

  const openPackage = async (key: string) => {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r?.selectedRm) return;
    const { data, error } = await supabase.from("raw_materials").select("id, legal_entity_id, name, base_unit, category, current_cost_price").eq("id", r.selectedRm).maybeSingle();
    if (error || !data) { toast.error("Kunne ikke hente råvaren"); return; }
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
  const counts = {
    ready: rows.filter((r) => r.status === "ready").length,
    applied: rows.filter((r) => r.applyState === "applied").length,
    failed: rows.filter((r) => r.status === "error" || r.applyState === "failed").length,
  };

  return (
    <div className="space-y-4">
      {guard.dialog}
      <div>
        {!embedded && <h1 className="text-2xl font-semibold tracking-tight">Last opp datablad</h1>}
        <p className="text-caption text-ink-secondary">Last opp inntil {MAX_BULK_FILES} datablad. AI foreslår råvare; du kontrollerer og anvender hver fil.</p>
      </div>

      {rows.length === 0 && (canWrite ? (
        <Card className="border-2 border-dashed p-8 text-center md:p-12">
          <Upload className="mx-auto mb-3 h-10 w-10 text-ink-secondary" aria-hidden />
          <input id="bulk" type="file" multiple accept="application/pdf,image/*" className="sr-only" onChange={(e) => void onPick(e)} />
          <label htmlFor="bulk"><Button asChild className="h-11"><span className="cursor-pointer">Velg filer (maks {MAX_BULK_FILES})</span></Button></label>
        </Card>
      ) : <p className="text-sm text-ink-secondary">Du har lesetilgang. Opplasting krever skrivetilgang.</p>)}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-secondary" role="status">
              {rows.length} filer · {counts.ready} lest · {counts.applied} anvendt · {counts.failed} med feil{processing ? " · behandler…" : ""}
            </p>
            {canWrite && (
              <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={openBulk} disabled={applyBusy || processing}>
                {applyBusy && progress.total > 0 ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />Anvender {progress.done} av {progress.total}…</> : "Bekreft alle trygge treff…"}
              </Button>
            )}
          </div>
          <Card><ul className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <BulkFileRow
                key={r.key} row={r} canWrite={canWrite} locked={applyBusy} materials={materials}
                onSelect={(id, manual) => { if (!applyBusy) update(gen.current, r.key, { selectedRm: id, manualTarget: manual, applyError: undefined, applyState: r.applyState === "failed" ? "idle" : r.applyState }); }}
                onApply={() => void applySingle(r.key)}
                onRetry={() => void retry(r.key)}
                onCreate={() => setCreateKey(r.key)}
                onOpenPackage={() => void openPackage(r.key)}
              />
            ))}
          </ul></Card>
        </>
      )}

      <OrphanCleanup legalEntityId={legalEntityId ?? null} canWrite={canWrite} />

      <AlertDialog open={!!bulkConfirm} onOpenChange={(v) => { if (!v) setBulkConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anvende {bulkConfirm?.length} datablad?</AlertDialogTitle>
            <AlertDialogDescription>Bare filer der valgt mål er toppkandidaten med høy tillit. Næring, allergener (bare tillegg), deklarasjon og korn skrives. Pakning skrives ikke.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 overflow-y-auto text-sm" aria-label="Filer som anvendes">
            {bulkConfirm?.map((b) => <li key={b.key} className="truncate">{b.file} → <span className="font-medium">{b.target}</span></li>)}
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
            // Ny råvare er opprettet: målet låses til den. Feiler anvend, prøves anvend igjen — ingen ny råvare.
            update(gen.current, key, { candidates: [{ id: rmId, name: createRow.summary?.name ?? "Ny råvare", sku: "", score: 1 }], selectedRm: rmId, manualTarget: true });
            void (async () => { setApplyBusy(true); try { await applyOne(gen.current, key, rmId); } finally { setApplyBusy(false); } })();
          }}
          onUseExisting={(rmId) => {
            const key = createRow.key;
            setCreateKey(null);
            update(gen.current, key, { selectedRm: rmId, manualTarget: true });
          }}
        />
      )}
    </div>
  );
}
