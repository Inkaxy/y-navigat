import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Sparkles, ShieldCheck, AlertTriangle, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useRavarer } from "@/ravarer/context/RavarerContext";

interface Props { rawMaterialId: string; }

const GRAIN_OPTIONS: { value: string; label: string }[] = [
  { value: "__none__", label: "Ikke klassifisert" },
  { value: "sifted_flour", label: "Siktet mel" },
  { value: "whole_grain_flour", label: "Sammalt / fullkornsmel" },
  { value: "whole_grains", label: "Hele korn" },
  { value: "wheat_bran", label: "Hvetekli (×4,5)" },
  { value: "rye_bran", label: "Rugkli (×4,0)" },
  { value: "oat_bran", label: "Havrekli (×2,0)" },
  { value: "gluten_free_grain", label: "Glutenfritt korn" },
  { value: "other_flour", label: "Annet mel (teller i nevner)" },
  { value: "not_grain", label: "Ikke korn (smør, sukker, frø …)" },
];

export function CompositeAndGrainSection({ rawMaterialId }: Props) {
  const { canWrite } = useRavarer();
  const qc = useQueryClient();
  const [parsing, setParsing] = useState(false);

  const rmQuery = useQuery({
    queryKey: ["rm-composite", rawMaterialId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, is_composite, components_reviewed_at, grain_classification")
        .eq("id", rawMaterialId).maybeSingle();
      return data;
    },
  });

  const compQuery = useQuery({
    queryKey: ["rm-components", rawMaterialId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_material_components")
        .select("id, component_raw_material_id, primary_ingredient_name, percentage, sort_order, is_explicit_percentage, raw_materials:raw_materials!component_raw_material_id(id, name)")
        .eq("parent_raw_material_id", rawMaterialId)
        .order("sort_order");
      return data ?? [];
    },
  });

  const rm = rmQuery.data;
  const components = compQuery.data ?? [];
  const sumPct = components.reduce((s: number, c: any) => s + Number(c.percentage), 0);

  async function toggleComposite(on: boolean) {
    const { error } = await supabase.from("raw_materials").update({ is_composite: on }).eq("id", rawMaterialId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-composite", rawMaterialId] });
  }

  async function setGrain(v: string) {
    const value = v === "__none__" ? null : v;
    const { error } = await supabase.from("raw_materials").update({ grain_classification: value }).eq("id", rawMaterialId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-composite", rawMaterialId] });
    toast.success("Lagret");
  }

  async function aiParse() {
    setParsing(true);
    const { data, error } = await supabase.functions.invoke("parse-composite-ingredient", {
      body: { raw_material_id: rawMaterialId },
    });
    setParsing(false);
    if (error) return toast.error(error.message ?? "AI-parsing feilet");
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success(`AI fant ${(data as any)?.count ?? 0} komponenter`);
    qc.invalidateQueries({ queryKey: ["rm-composite", rawMaterialId] });
    qc.invalidateQueries({ queryKey: ["rm-components", rawMaterialId] });
  }

  async function addRow() {
    const nextSort = components.length;
    const { error } = await supabase.from("raw_material_components").insert({
      parent_raw_material_id: rawMaterialId,
      primary_ingredient_name: "Ny komponent",
      percentage: 1,
      sort_order: nextSort,
      is_explicit_percentage: true,
    } as never);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-components", rawMaterialId] });
  }

  async function updateRow(id: string, patch: any) {
    const { error } = await supabase.from("raw_material_components").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-components", rawMaterialId] });
  }

  async function deleteRow(id: string) {
    const { error } = await supabase.from("raw_material_components").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-components", rawMaterialId] });
  }

  async function markReviewed() {
    const { error } = await supabase.from("raw_materials")
      .update({ components_reviewed_at: new Date().toISOString() }).eq("id", rawMaterialId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rm-composite", rawMaterialId] });
    toast.success("Markert som gjennomgått");
  }

  if (rmQuery.isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!rm) return null;

  const sumStatus: { color: string; text: string } =
    sumPct >= 99.5 && sumPct <= 100.5 ? { color: "text-success", text: `Sum: ${sumPct.toFixed(1)} %  ✓` } :
    sumPct >= 50 && sumPct < 99.5 ? { color: "text-warning", text: `Sum: ${sumPct.toFixed(1)} %  (vann/luft kan utgjøre resten)` } :
    { color: "text-destructive", text: `Sum: ${sumPct.toFixed(1)} %  (utenfor 50–100 %)` };

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Sammensatt råvare</h3>
            <p className="text-xs text-muted-foreground">Strukturerte komponenter brukes for korrekt deklarasjon og QUID-aggregering.</p>
          </div>
          <Switch checked={!!rm.is_composite} onCheckedChange={toggleComposite} disabled={!canWrite} />
        </div>

        {rm.is_composite && (
          <>
            {!rm.components_reviewed_at && components.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                <div className="flex-1">
                  AI/import har foreslått komponenter. Verifiser før bruk i deklarasjon.
                </div>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={markReviewed}>
                    <ShieldCheck className="h-3 w-3 mr-1" /> Marker som gjennomgått
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {canWrite && (
                <>
                  <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-3 w-3 mr-1" /> Legg til</Button>
                  <Button size="sm" variant="outline" onClick={aiParse} disabled={parsing}>
                    {parsing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    AI: importer fra fritekst
                  </Button>
                </>
              )}
            </div>

            <div className="rounded-md border border-border">
              {components.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Ingen komponenter ennå.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-8"></th>
                      <th className="px-2 py-1 text-left">Komponent</th>
                      <th className="px-2 py-1 text-right w-24">%</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((c: any) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-2 py-1 text-muted-foreground"><GripVertical className="h-3 w-3" /></td>
                        <td className="px-2 py-1">
                          <Input
                            value={c.raw_materials?.name ?? c.primary_ingredient_name ?? ""}
                            disabled={!canWrite || !!c.component_raw_material_id}
                            onBlur={(e) => {
                              if (c.component_raw_material_id) return;
                              if (e.target.value !== c.primary_ingredient_name) updateRow(c.id, { primary_ingredient_name: e.target.value });
                            }}
                            onChange={(e) => {
                              // local edit
                              c.primary_ingredient_name = e.target.value;
                            }}
                            className="h-8"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" step="0.1" defaultValue={c.percentage}
                            disabled={!canWrite}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v !== Number(c.percentage)) updateRow(c.id, { percentage: v });
                            }}
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="px-2 py-1">
                          {canWrite && (
                            <button onClick={() => deleteRow(c.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {components.length > 0 && (
              <div className={`text-xs ${sumStatus.color}`}>{sumStatus.text}</div>
            )}
          </>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div>
          <h3 className="text-base font-semibold">Brødskala'n-klassifisering</h3>
          <p className="text-xs text-muted-foreground">Brukes til å beregne grovhetsprosent for brød. Sett "Ikke korn" for råvarer som ikke skal med.</p>
        </div>
        <Select value={rm.grain_classification ?? "__none__"} onValueChange={setGrain} disabled={!canWrite}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {GRAIN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {rm.grain_classification && (
          <Badge variant="outline" className="text-xs">Aktiv: {GRAIN_OPTIONS.find((o) => o.value === rm.grain_classification)?.label}</Badge>
        )}
      </Card>
    </>
  );
}
