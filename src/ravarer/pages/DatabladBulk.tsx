import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileText, Check, RefreshCw, AlertCircle, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { CreateRawMaterialFromDatasheetDialog, type DatasheetExtract } from "@/ravarer/components/CreateRawMaterialFromDatasheetDialog";

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
    }
  };

  const updateRow = (i: number, patch: Partial<FileRow>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const processRow = async (i: number, row: FileRow, batch_id?: string) => {
    let storage_path = row.storage_path;
    try {
      if (!storage_path) {
        updateRow(i, { status: "uploading", stage: "upload", error: undefined });
        storage_path = `bulk/${batch_id}/${Date.now()}-${row.file.name}`;
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
      const { data: match, error: matchErr } = await supabase.functions.invoke("match-datasheet-to-raw-material", {
        body: { datasheet_id: ext.datasheet_id },
      });
      if (matchErr) throw new Error(`Matching feilet: ${matchErr.message}`);
      if (match?.error) throw new Error(`Matching: ${match.error}`);

      updateRow(i, {
        status: "ready",
        stage: undefined,
        candidates: match?.candidates ?? [],
        selectedRm: match?.candidates?.[0]?.score >= 0.7 ? match.candidates[0].id : undefined,
        error: undefined,
      });
    } catch (e: any) {
      console.error(`[DatabladBulk] ${row.file.name}:`, e);
      updateRow(i, { status: "error", error: e.message ?? String(e) });
    }
  };

  const retryRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    processRow(i, r, batchId ?? undefined);
  };

  const applyRow = async (i: number) => {
    const r = rows[i];
    if (!r.datasheet_id || !r.selectedRm) return;
    try {
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", {
        body: {
          datasheet_id: r.datasheet_id,
          raw_material_id: r.selectedRm,
          accepted_fields: ["nutrition", "allergens", "ingredient_declaration", "composite", "grain", "package"],
        },
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Ingen respons fra apply-datasheet-update");
      if (data.error) throw new Error(data.error);
      updateRow(i, { applied: true });
      toast.success(`${r.file.name}: ${data.changes_logged} endringer logget`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const applyAllHigh = () => {
    rows.forEach((r, i) => {
      if (r.status === "ready" && !r.applied && r.candidates?.[0]?.score && r.candidates[0].score >= 0.7) {
        applyRow(i);
      }
    });
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
            <Button variant="outline" size="sm" onClick={applyAllHigh}>Bekreft alle høy-konfidens</Button>
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
                    {r.status === "ready" && (!r.candidates || r.candidates.length === 0) && "Ingen match funnet"}
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
    </div>
  );
}
