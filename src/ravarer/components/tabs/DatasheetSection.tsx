import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileText, Loader2, Sparkles, History, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDatasheets } from "@/ravarer/hooks/useDatasheets";
import { useChangelog } from "@/ravarer/hooks/useDatasheets";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { formatDate } from "@/ravarer/lib/constants";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

interface Props { rawMaterialId: string }

const FIELD_LABELS: Record<string, string> = {
  nutrition: "Næring",
  allergens: "Allergener",
  ingredient_declaration: "Ingrediensdeklarasjon",
  composite: "Sammensetning",
  grain: "Brødskala-klassifisering",
  package: "Pakningsstørrelse",
};

export function DatasheetSection({ rawMaterialId }: Props) {
  const { canWrite, legalEntityId } = useRavarer();
  const qc = useQueryClient();
  const { data: datasheets = [] } = useDatasheets(rawMaterialId);
  const { data: changelog = [] } = useChangelog({ rawMaterialId });
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<any | null>(null);
  const [datasheetId, setDatasheetId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleUpload = async (file: File) => {
    if (!canWrite) return;
    setUploading(true);
    try {
      if (!legalEntityId) throw new Error("Mangler valgt selskap (legal_entity_id)");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${legalEntityId}/${rawMaterialId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("raw-material-datasheets").upload(path, file);
      if (upErr) throw new Error(`Opplasting feilet: ${upErr.message}`);
      setUploading(false);
      setExtracting(true);
      const { data, error } = await supabase.functions.invoke("extract-datasheet", {
        body: { file_path: path, raw_material_id: rawMaterialId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setExtracted(data.extracted);
      setDatasheetId(data.datasheet_id);
      // Pre-select alle felter som har verdi
      const auto = new Set<string>();
      if (data.extracted.nutrition) auto.add("nutrition");
      if (data.extracted.allergens?.length) auto.add("allergens");
      if (data.extracted.ingredient_declaration) auto.add("ingredient_declaration");
      if (data.extracted.composite_components?.length) auto.add("composite");
      if (data.extracted.grain_classification_hint) auto.add("grain");
      if (data.extracted.package_size_value) auto.add("package");
      setAccepted(auto);
    } catch (e: any) {
      toast.error(e.message ?? "Opplasting feilet");
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  const handleApply = async () => {
    if (!datasheetId) return;
    try {
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", {
        body: { datasheet_id: datasheetId, raw_material_id: rawMaterialId, accepted_fields: Array.from(accepted) },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast.success(`Lagret ${data.changes_logged} endringer · ${data.affected_products} produkter flagget`);
      setExtracted(null);
      setDatasheetId(null);
      invalidateRawMaterial(qc, rawMaterialId);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggle = (k: string) => {
    const n = new Set(accepted);
    n.has(k) ? n.delete(k) : n.add(k);
    setAccepted(n);
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> Datablad
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="mr-1.5 h-3.5 w-3.5" /> Versjonshistorikk
        </Button>
      </div>

      {!extracted && canWrite && (
        <div className="rounded-xl border-2 border-dashed border-line-subtle p-6 text-center">
          <Upload className="mx-auto h-8 w-8 text-ink-secondary mb-2" />
          <p className="text-sm text-ink-secondary mb-3">Last opp leverandørens datablad (PDF eller bilde) for AI-ekstrahering.</p>
          <input
            type="file"
            id="ds-upload"
            className="hidden"
            accept="application/pdf,image/*"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
            disabled={uploading || extracting}
          />
          <label htmlFor="ds-upload">
            <Button asChild disabled={uploading || extracting}>
              <span className="cursor-pointer">
                {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Laster opp…</>
                  : extracting ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> AI analyserer…</>
                  : <><Upload className="mr-1.5 h-3.5 w-3.5" /> Velg fil</>}
              </span>
            </Button>
          </label>
        </div>
      )}

      {extracted && (
        <div className="rounded-xl border border-line-subtle bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-app" />
            AI fant {Object.keys(FIELD_LABELS).filter(k => isFieldPresent(extracted, k)).length} oppdaterbare felter
            {extracted.confidence != null && (
              <Badge variant="outline" className="text-xs">Confidence {Math.round(extracted.confidence * 100)}%</Badge>
            )}
          </div>
          <div className="space-y-2">
            {Object.entries(FIELD_LABELS).filter(([k]) => isFieldPresent(extracted, k)).map(([k, label]) => (
              <label key={k} className="flex items-start gap-2 rounded-lg bg-surface-raised p-3 cursor-pointer hover:bg-muted/50">
                <Checkbox checked={accepted.has(k)} onCheckedChange={() => toggle(k)} />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-ink-secondary mt-0.5">{summary(extracted, k)}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setExtracted(null); setDatasheetId(null); }}>Avbryt</Button>
            <Button onClick={handleApply} disabled={accepted.size === 0}>Anvend valgte ({accepted.size})</Button>
          </div>
        </div>
      )}

      {datasheets.length > 0 && (
        <div className="text-xs text-ink-secondary">
          {datasheets.length} datablad lastet opp · siste {formatDate(datasheets[0].uploaded_at)}
        </div>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Versjonshistorikk</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {datasheets.length === 0 && changelog.length === 0 && (
              <p className="text-sm text-ink-secondary">Ingen historikk.</p>
            )}
            {datasheets.map(ds => (
              <div key={ds.id} className="rounded-lg border border-line-subtle p-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">📅 {formatDate(ds.uploaded_at)} · Datablad lastet opp</div>
                  {ds.is_current && <Badge variant="secondary" className="text-xs">Gjeldende</Badge>}
                </div>
                <div className="text-xs text-ink-secondary mt-1">{ds.file_name}</div>
              </div>
            ))}
            {changelog.map(c => (
              <div key={c.id} className="rounded-lg border border-line-subtle p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span>{c.severity === "high" ? "🔴" : c.severity === "medium" ? "🟡" : "⚪"}</span>
                  <span className="font-medium">{describeChange(c)}</span>
                </div>
                <div className="text-xs text-ink-secondary mt-1">{formatDate(c.created_at)}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function isFieldPresent(ext: any, key: string): boolean {
  switch (key) {
    case "nutrition": return ext.nutrition && Object.values(ext.nutrition).some(v => v != null);
    case "allergens": return Array.isArray(ext.allergens) && ext.allergens.length > 0;
    case "ingredient_declaration": return !!ext.ingredient_declaration;
    case "composite": return Array.isArray(ext.composite_components) && ext.composite_components.length > 0;
    case "grain": return !!ext.grain_classification_hint;
    case "package": return ext.package_size_value != null;
  }
  return false;
}

function summary(ext: any, key: string): string {
  switch (key) {
    case "nutrition": return `Energi ${ext.nutrition?.energy_kcal ?? "?"} kcal · Protein ${ext.nutrition?.protein_g ?? "?"} g · Fett ${ext.nutrition?.fat_g ?? "?"} g`;
    case "allergens": return ext.allergens.map((a: any) => `${a.allergen} (${a.presence})`).join(", ");
    case "ingredient_declaration": return ext.ingredient_declaration.slice(0, 120) + (ext.ingredient_declaration.length > 120 ? "…" : "");
    case "composite": return ext.composite_components.map((c: any) => c.name + (c.percentage ? ` (${c.percentage}%)` : "")).join(", ");
    case "grain": return ext.grain_classification_hint;
    case "package": return `${ext.package_size_value} ${ext.package_size_unit ?? ""}`;
  }
  return "";
}

function describeChange(c: any): string {
  const map: Record<string, string> = {
    allergen_added: `Allergen lagt til: ${c.field}`,
    allergen_removed: `Allergen fjernet: ${c.field}`,
    nutrition_changed: `${c.field}: ${c.old_value ?? "—"} → ${c.new_value}`,
    composition_changed: `Sammensetning endret`,
    grain_changed: `Brødskala: ${c.old_value ?? "—"} → ${c.new_value}`,
    package_changed: `Pakning endret`,
    created: "Råvare opprettet",
  };
  return map[c.change_type] ?? c.change_type;
}
