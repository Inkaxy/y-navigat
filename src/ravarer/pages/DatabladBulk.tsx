import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileText, Check, RefreshCw, AlertCircle, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { CreateRawMaterialFromDatasheetDialog, type DatasheetExtract } from "@/ravarer/components/CreateRawMaterialFromDatasheetDialog";
import { useDeleteDatasheets, useOrphanDatasheets } from "@/ravarer/hooks/useDatasheets";
import { formatDate } from "@/ravarer/lib/constants";

interface FileRow {
  file: File;
  status: "pending" | "uploading" | "extracting" | "matching" | "ready" | "error";
  stage?: "upload" | "extract" | "match" | "apply";
  storage_path?: string;
  datasheet_id?: string;
  extracted?: DatasheetExtract;
  candidates?: { id: string; name: string; sku: string; score: number }[];
  selectedRm?: string;
  error?: string;
  applied?: boolean;
}

export default function DatabladBulk() {
  const { canWrite, legalEntityId } = useRavarer();
  const [rows, setRows] = useState<FileRow[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [createDialogIdx, setCreateDialogIdx] = useState<number | null>(null);
  const { data: orphans = [] } = useOrphanDatasheets(legalEntityId ?? undefined);
  const deleteDatasheets = useDeleteDatasheets();
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });
  const rowsRef = useRef<FileRow[]>([]);
  rowsRef.current = rows;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 100);
    if (files.length === 0) return;
    const newRows: FileRow[] = files.map(f => ({ file: f, status: "pending" }));
    setRows(newRows);

    const { data: batch } = await supabase.from("datasheet_upload_batches").insert({
      legal_entity_id: legalEntityId,
      total_files: files.length,
    }).select("id").single();
    setBatchId(batch?.id ?? null);

    for (let i = 0; i < newRows.length; i++) {
      await processRow(i, newRows[i], batch?.id);
      await syncBatch(batch?.id ?? null);
    }
    await syncBatch(batch?.id ?? null, "completed");
  };

  /** Holder datasheet_upload_batches i takt med hva som faktisk er behandlet. */
  const syncBatch = async (id: string | null, status?: "completed") => {
    if (!id) return;
    const current = rowsRef.current;
    const failed = current.filter((r) => r.status === "error").length;
    const processed = current.filter((r) => r.status === "ready" || r.applied).length;
    await supabase
      .from("datasheet_upload_batches")
      .update({
        processed,
        failed,
        status: status ?? "processing",
        ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq("id", id);
  };

  const updateRow = (i: number, patch: Partial<FileRow>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const processRow = async (i: number, row: FileRow, batch_id?: string) => {
    let storage_path = row.storage_path;
    try {
      if (!storage_path) {
        updateRow(i, { status: "uploading", stage: "upload", error: undefined });
        if (!legalEntityId) throw new Error("Mangler legal_entity_id");
        const safeName = row.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        storage_path = `${legalEntityId}/bulk/${batch_id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("raw-material-datasheets").upload(storage_path, row.file);
        if (upErr) throw new Error(`Opplasting feilet: ${upErr.message}`);
        updateRow(i, { storage_path });
      }

      updateRow(i, { status: "extracting", stage: "extract", error: undefined });
      const { data: ext, error: extErr } = await supabase.functions.invoke("extract-datasheet", {
        body: { file_path: storage_path, batch_id },
      });
      if (extErr) throw new Error(`AI-ekstrahering feilet: ${extErr.message}`);
      if (!ext) throw new Error("AI-ekstrahering: ingen respons fra serveren");
      if (ext.error) throw new Error(`AI-ekstrahering: ${ext.error}`);

      updateRow(i, { status: "matching", stage: "match", datasheet_id: ext.datasheet_id });

      // Hent ai_extracted slik at vi kan forhåndsutfylle "Opprett ny råvare" hvis ingen match
      const { data: dsRow } = await supabase
        .from("raw_material_datasheets")
        .select("ai_extracted, file_name")
        .eq("id", ext.datasheet_id)
        .maybeSingle();
      const extracted = (dsRow?.ai_extracted ?? {}) as DatasheetExtract;

      const { data: match, error: matchErr } = await supabase.functions.invoke("match-datasheet-to-raw-material", {
        body: { datasheet_id: ext.datasheet_id },
      });
      if (matchErr) throw new Error(`Matching feilet: ${matchErr.message}`);
      if (match?.error) throw new Error(`Matching: ${match.error}`);

      updateRow(i, {
        status: "ready",
        stage: undefined,
        extracted,
        candidates: match?.candidates ?? [],
        selectedRm: match?.candidates?.[0]?.score >= 0.7 ? match.candidates[0].id : undefined,
        error: undefined,
      });
    } catch (e: unknown) {
      console.error(`[DatabladBulk] ${row.file.name}:`, e);
      updateRow(i, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const retryRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    processRow(i, r, batchId ?? undefined);
  };

  const applyRow = async (i: number, silent = false): Promise<boolean> => {
    const r = rowsRef.current[i] ?? rows[i];
    if (!r?.datasheet_id || !r.selectedRm) return false;
    try {
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", {
        body: {
          datasheet_id: r.datasheet_id,
          raw_material_id: r.selectedRm,
          // «composite» er bevisst IKKE med som standard: AI-komponenter er ren tekst,
          // og ville ellers overstyrt råvarens egen næring og allergener.
          accepted_fields: ["nutrition", "allergens", "ingredient_declaration", "grain", "package"],
        },
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Ingen respons fra apply-datasheet-update");
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        throw new Error(`Noe ble ikke lagret: ${data.failures.join(" · ")}`);
      }
      updateRow(i, { applied: true });
      if (!silent) toast.success(`${r.file.name}: ${data.changes_logged} endringer logget`);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) toast.error(msg);
      else updateRow(i, { error: msg });
      return false;
    }
  };

  /** Knytter databladet til råvaren med én gang et treff velges. */
  const selectRm = async (i: number, rawMaterialId: string) => {
    updateRow(i, { selectedRm: rawMaterialId });
    const dsId = rowsRef.current[i]?.datasheet_id;
    if (dsId) {
      await supabase.from("raw_material_datasheets").update({ raw_material_id: rawMaterialId }).eq("id", dsId);
    }
  };

  const applyAllHigh = async () => {
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === "ready" && !r.applied && (r.candidates?.[0]?.score ?? 0) >= 0.7);
    if (targets.length === 0) {
      toast.info("Ingen datablad med høy nok tillit å bekrefte.");
      return;
    }
    setApplyingAll(true);
    setApplyProgress({ done: 0, total: targets.length });
    let ok = 0;
    for (let n = 0; n < targets.length; n++) {
      const { i, r } = targets[n];
      if (!r.selectedRm && r.candidates?.[0]?.id) await selectRm(i, r.candidates[0].id);
      const done = await applyRow(i, true);
      if (done) ok++;
      setApplyProgress({ done: n + 1, total: targets.length });
    }
    setApplyingAll(false);
    await syncBatch(batchId, "completed");
    if (ok === targets.length) toast.success(`${ok} datablad anvendt`);
    else toast.warning(`${ok} av ${targets.length} datablad anvendt — resten står igjen med feilmelding`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>Bulk-opplasting datablad</h1>
        <p className="text-sm text-ink-secondary">Last opp inntil 100 datablad. AI matcher hver fil mot eksisterende råvarer.</p>
      </div>

      {rows.length === 0 && canWrite && (
        <Card className="p-12 text-center border-2 border-dashed">
          <Upload className="mx-auto h-10 w-10 text-ink-secondary mb-3" />
          <input id="bulk" type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={onPick} />
          <label htmlFor="bulk">
            <Button asChild><span className="cursor-pointer">Velg filer (maks 100)</span></Button>
          </label>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={applyAllHigh} disabled={applyingAll}>
              {applyingAll
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Bekrefter {applyProgress.done} av {applyProgress.total}…</>
                : "Bekreft alle høy-konfidens"}
            </Button>
          </div>
          <Card className="divide-y divide-line-subtle">
            {rows.map((r, i) => (
              <div key={i} className="p-4 flex items-start gap-3">
                {r.status === "error"
                  ? <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                  : <FileText className="h-4 w-4 text-ink-secondary mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.file.name}</div>
                  <div className="text-xs text-ink-secondary mt-0.5">
                    {r.status === "uploading" && "Laster opp…"}
                    {r.status === "extracting" && "AI analyserer…"}
                    {r.status === "matching" && "Matcher…"}
                    {r.status === "ready" && r.candidates && r.candidates.length > 0 && (
                      <>Foreslått: {r.candidates[0].name} <Badge variant="outline" className="ml-1 text-xs">{Math.round(r.candidates[0].score * 100)}%</Badge></>
                    )}
                    {r.status === "ready" && (!r.candidates || r.candidates.length === 0) && (
                      <span>Ingen match funnet{r.extracted?.name ? <> · AI leste: <span className="font-medium">{r.extracted.name}</span></> : null}</span>
                    )}
                    {r.applied && <span className="text-success ml-2">✓ Anvendt</span>}
                  </div>
                  {r.status === "error" && (
                    <div className="mt-1.5 rounded-lg bg-destructive/10 border border-destructive/20 px-2.5 py-1.5">
                      <div className="text-xs text-destructive font-medium break-words">{r.error}</div>
                    </div>
                  )}
                </div>
                {(r.status === "uploading" || r.status === "extracting" || r.status === "matching") && <Loader2 className="h-4 w-4 animate-spin mt-0.5" />}
                {r.status === "ready" && !r.applied && r.selectedRm && (
                  <Button size="sm" onClick={() => applyRow(i)}><Check className="mr-1 h-3.5 w-3.5" /> Anvend</Button>
                )}
                {r.status === "ready" && !r.applied && !r.selectedRm && r.datasheet_id && canWrite && (
                  <Button size="sm" variant="outline" onClick={() => setCreateDialogIdx(i)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Opprett ny råvare
                  </Button>
                )}
                {r.status === "error" && (
                  <Button size="sm" variant="outline" onClick={() => retryRow(i)}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Prøv igjen
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {orphans.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Rydd opp</h2>
              <p className="text-sm text-ink-secondary">
                {orphans.length} datablad er aldri knyttet til en råvare. Slett dem, eller last dem opp på nytt fra
                råvarekortet.
              </p>
            </div>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                disabled={deleteDatasheets.isPending}
                onClick={() => deleteDatasheets.mutate(orphans.map((o) => o.id))}
              >
                Slett alle ({orphans.length})
              </Button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-line-subtle rounded-lg border border-line-subtle">
            {orphans.map((o) => (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1 truncate">{o.file_name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">{o.supplier_name ?? "—"}</span>
                <span className="shrink-0 text-xs text-ink-secondary">{formatDate(o.uploaded_at)}</span>
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Slett ${o.file_name}`}
                    disabled={deleteDatasheets.isPending}
                    onClick={() => deleteDatasheets.mutate([o.id])}
                  >
                    Slett
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {createDialogIdx !== null && rows[createDialogIdx]?.datasheet_id && (
        <CreateRawMaterialFromDatasheetDialog
          open={createDialogIdx !== null}
          onOpenChange={(v) => { if (!v) setCreateDialogIdx(null); }}
          datasheetId={rows[createDialogIdx].datasheet_id!}
          fileName={rows[createDialogIdx].file.name}
          extracted={rows[createDialogIdx].extracted ?? {}}
          onCreated={(rmId) => {
            const idx = createDialogIdx;
            updateRow(idx, { candidates: [{ id: rmId, name: rows[idx].extracted?.name ?? "Ny råvare", sku: rows[idx].extracted?.sku ?? "", score: 1 }] });
            // Auto-anvend datablad-felter på den nye råvaren
            void selectRm(idx, rmId).then(() => applyRow(idx));
          }}
        />
      )}
    </div>
  );
}
