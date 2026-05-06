import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle, FileText, Eye, Save, Copy, Printer, Sparkles, ShieldCheck, Link2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logAudit } from "@/varer/lib/audit";

type Mode = "auto" | "manual" | "auto_with_overrides";

const NUTRITION_FIELDS = [
  { key: "energy_kj", label: "Energi (kJ)" },
  { key: "energy_kcal", label: "Energi (kcal)" },
  { key: "fat_g", label: "Fett (g)" },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer (g)" },
  { key: "carbs_g", label: "Karbohydrater (g)" },
  { key: "sugars_g", label: "— hvorav sukkerarter (g)" },
  { key: "fiber_g", label: "Fiber (g)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "salt_g", label: "Salt (g)" },
] as const;

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

export function DeclarationTab({ productId, productName, canWrite }: Props) {
  const qc = useQueryClient();

  const linkQuery = useQuery({
    queryKey: ["product-recipe-link-decl", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("id, recipe_id, declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary, declaration_updated_at, recipes(declaration_mode, manual_ingredient_declaration, manual_nutrition, manual_allergen_summary)")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  if (linkQuery.isLoading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!linkQuery.data) {
    return (
      <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
        Ingen aktiv oppskrift koblet til dette produktet. Opprett eller koble til en oppskrift først.
      </CardContent></Card>
    );
  }

  return <DeclarationView link={linkQuery.data} productName={productName} canWrite={canWrite} qc={qc} />;
}

function DeclarationView({ link, productName, canWrite, qc }: { link: any; productName: string; canWrite: boolean; qc: ReturnType<typeof useQueryClient> }) {
  // Effektiv modus: kobling vinner, ellers master, ellers auto
  const inheritedMode: Mode = link.recipes?.declaration_mode ?? "auto";
  const effectiveMode: Mode = (link.declaration_mode ?? inheritedMode) as Mode;
  const isOverridden = link.declaration_mode != null;

  const [mode, setMode] = useState<Mode>(effectiveMode);
  const initialIngredient = link.manual_ingredient_declaration ?? link.recipes?.manual_ingredient_declaration ?? "";
  const initialNutrition = (link.manual_nutrition ?? link.recipes?.manual_nutrition ?? {}) as Record<string, number>;
  const initialAllergens = (link.manual_allergen_summary ?? link.recipes?.manual_allergen_summary ?? {}) as any;

  const [manualIngredient, setManualIngredient] = useState<string>(initialIngredient);
  const [manualNutrition, setManualNutrition] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of NUTRITION_FIELDS) out[f.key] = initialNutrition[f.key] != null ? String(initialNutrition[f.key]) : "";
    return out;
  });
  const [manualContains, setManualContains] = useState<string>((initialAllergens?.contains ?? []).join(", "));
  const [manualMayContain, setManualMayContain] = useState<string>((initialAllergens?.may_contain ?? []).join(", "));
  const [savingMode, setSavingMode] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const computeQuery = useQuery({
    queryKey: ["compute-product-declaration", link.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("compute-product-declaration", {
        body: { product_recipe_link_id: link.id },
      });
      if (error) throw error;
      return data as ComputedDeclaration;
    },
  });

  const computed = computeQuery.data;

  async function changeMode(newMode: Mode | "inherit") {
    setSavingMode(true);
    const update: any = {
      declaration_updated_at: new Date().toISOString(),
    };
    if (newMode === "inherit") {
      update.declaration_mode = null;
    } else {
      update.declaration_mode = newMode;
    }
    const { error } = await supabase.from("product_recipe_links").update(update).eq("id", link.id);
    setSavingMode(false);
    if (error) { toast.error(error.message); return; }
    if (newMode !== "inherit") setMode(newMode);
    await logAudit({ action: "update", entity_type: "product_recipe_link", entity_id: link.id, entity_display_reference: productName, changes: { declaration_mode: newMode } });
    qc.invalidateQueries({ queryKey: ["product-recipe-link-decl", link.id] });
    qc.invalidateQueries({ queryKey: ["compute-product-declaration", link.id] });
    toast.success("Modus oppdatert");
  }

  async function saveManual() {
    const nut: Record<string, number> = {};
    for (const f of NUTRITION_FIELDS) {
      const v = manualNutrition[f.key];
      if (v !== "" && Number.isFinite(Number(v))) nut[f.key] = Number(v);
    }
    const { error } = await supabase.from("product_recipe_links").update({
      manual_ingredient_declaration: manualIngredient || null,
      manual_nutrition: Object.keys(nut).length ? nut : null,
      manual_allergen_summary: {
        contains: manualContains.split(",").map((s) => s.trim()).filter(Boolean),
        may_contain: manualMayContain.split(",").map((s) => s.trim()).filter(Boolean),
      },
      declaration_updated_at: new Date().toISOString(),
    }).eq("id", link.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Manuell deklarasjon lagret");
    qc.invalidateQueries({ queryKey: ["product-recipe-link-decl", link.id] });
    qc.invalidateQueries({ queryKey: ["compute-product-declaration", link.id] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ModeSelector mode={mode} canWrite={canWrite} saving={savingMode} onChange={changeMode} />
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isOverridden ? (
            <Badge variant="default" className="gap-1"><Link2 className="h-3 w-3" /> Overstyrt pr produkt</Badge>
          ) : (
            <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Arvet fra master ({inheritedMode})</Badge>
          )}
          {isOverridden && canWrite && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => changeMode("inherit")}>
              Bruk master
            </Button>
          )}
        </div>
      </div>

      {computeQuery.isLoading && (
        <Card><CardContent className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      )}

      {computed && <DataQualityBanner computed={computed} />}

      {computed && (
        <Tabs defaultValue="ingredient">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="ingredient">Ingrediensdeklarasjon</TabsTrigger>
              <TabsTrigger value="nutrition">Næring / 100 g</TabsTrigger>
              <TabsTrigger value="allergens">Allergener</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-1.5 h-4 w-4" /> Forhåndsvis etikett
            </Button>
          </div>

          <TabsContent value="ingredient" className="mt-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Ingrediensdeklarasjon</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Forhåndsvisning</Label>
                  <div
                    className="mt-1 rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: computed.ingredient_declaration_html || "<em>Ingen ingredienser å vise.</em>" }}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Allergener i <strong>fet</strong>. QUID-prosenter beregnes på tvers av master + tillegg.
                    {computed.data_quality.extra_lines > 0 && (
                      <> · <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">+{computed.data_quality.extra_lines} tillegg</Badge></>
                    )}
                  </p>
                </div>

                {/* Linje-breakdown med kilde-merking */}
                <div className="rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">Kilde</th>
                        <th className="px-2 py-1 text-left">Ingrediens</th>
                        <th className="px-2 py-1 text-right">Gram</th>
                        <th className="px-2 py-1 text-center">Næring?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computed.computed_lines.filter((l) => l.include).map((l, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1">
                            {l.source === "extra"
                              ? <Badge variant="default" className="h-4 px-1 text-[10px]">+ tillegg</Badge>
                              : <span className="text-muted-foreground">master</span>}
                          </td>
                          <td className="px-2 py-1">{l.name}{l.is_quid && <span className="ml-1 text-[10px] text-muted-foreground">QUID</span>}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Math.round(l.effective_grams * 10) / 10}</td>
                          <td className="px-2 py-1 text-center">{l.has_nutrition ? "✓" : <span className="text-warning">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {mode === "manual" && (
                  <div>
                    <Label>Manuell ingrediensdeklarasjon</Label>
                    <Textarea
                      rows={4}
                      value={manualIngredient}
                      disabled={!canWrite}
                      onChange={(e) => setManualIngredient(e.target.value)}
                      placeholder="Hvete<strong>mel</strong>, vann, salt …"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="nutrition" className="mt-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Næringsinnhold pr 100 g</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2 text-left">Næringsstoff</th><th className="text-right">Verdi</th></tr>
                  </thead>
                  <tbody>
                    {NUTRITION_FIELDS.map((f) => {
                      const v = (computed.nutrition_per_100g as any)?.[f.key];
                      return (
                        <tr key={f.key} className="border-t border-border">
                          <td className="py-2">{f.label}</td>
                          <td className="text-right tabular-nums">
                            {mode === "manual" ? (
                              <Input
                                type="number" step="0.1"
                                value={manualNutrition[f.key]}
                                disabled={!canWrite}
                                onChange={(e) => setManualNutrition((s) => ({ ...s, [f.key]: e.target.value }))}
                                className="ml-auto h-8 w-28 text-right"
                              />
                            ) : v != null ? v : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  Dekning: {computed.data_quality.nutrition_coverage_pct}% av vekten har næringsdata. Ferdigvekt: {Math.round(computed.final_weight_grams)} g.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="allergens" className="mt-3">
            <Card>
              <CardHeader><CardTitle className="text-base">Allergener</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Inneholder</Label>
                  {mode === "manual" ? (
                    <Input value={manualContains} disabled={!canWrite} onChange={(e) => setManualContains(e.target.value)} placeholder="hvete, melk, egg" />
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {computed.allergens_contains.length === 0
                        ? <span className="text-sm text-muted-foreground">Ingen registrerte allergener.</span>
                        : computed.allergens_contains.map((a) => <Badge key={a} variant="secondary">{a}</Badge>)}
                    </div>
                  )}
                </div>
                <div>
                  <Label>Kan inneholde spor av</Label>
                  {mode === "manual" ? (
                    <Input value={manualMayContain} disabled={!canWrite} onChange={(e) => setManualMayContain(e.target.value)} placeholder="nøtter, sesam" />
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {computed.allergens_may_contain.length === 0
                        ? <span className="text-sm text-muted-foreground">Ingen.</span>
                        : computed.allergens_may_contain.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {mode === "manual" && canWrite && (
        <div className="flex justify-end">
          <Button onClick={saveManual} className="bg-app hover:bg-app-dark text-app-foreground">
            <Save className="mr-2 h-4 w-4" /> Lagre manuell deklarasjon
          </Button>
        </div>
      )}

      {computed && (
        <PreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} productName={productName} computed={computed} />
      )}
    </div>
  );
}

function ModeSelector({ mode, canWrite, saving, onChange }: { mode: Mode; canWrite: boolean; saving: boolean; onChange: (m: Mode | "inherit") => void }) {
  const items: { value: Mode; title: string; desc: string; icon: React.ReactNode }[] = [
    { value: "auto", title: "Automatisk", desc: "Beregnes fra råvarer + oppskrift + tillegg.", icon: <Sparkles className="h-4 w-4" /> },
    { value: "auto_with_overrides", title: "Auto + overstyringer", desc: "Auto, med mulighet for å låse enkeltverdier.", icon: <ShieldCheck className="h-4 w-4" /> },
    { value: "manual", title: "Manuell", desc: "Du fyller alt selv. Ingen auto-beregning.", icon: <FileText className="h-4 w-4" /> },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 flex-1 min-w-[400px]">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          disabled={!canWrite || saving}
          onClick={() => onChange(it.value)}
          className={cn(
            "rounded-lg border p-3 text-left transition-all",
            mode === it.value ? "border-app bg-app/5 ring-1 ring-app/40" : "border-border hover:border-foreground/20",
            (!canWrite || saving) && "opacity-60 cursor-not-allowed",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium">{it.icon} {it.title}</div>
          <p className="mt-1 text-xs text-muted-foreground">{it.desc}</p>
        </button>
      ))}
    </div>
  );
}

function DataQualityBanner({ computed }: { computed: ComputedDeclaration }) {
  if (!computed.warnings || computed.warnings.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-4 w-4" /> Datakvalitet
      </div>
      <ul className="list-inside list-disc space-y-0.5 text-foreground/80">
        {computed.warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  );
}

function PreviewDialog({ open, onClose, productName, computed }: { open: boolean; onClose: () => void; productName: string; computed: ComputedDeclaration }) {
  function plainText(): string {
    const html = computed.ingredient_declaration_html || "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const text = tmp.textContent || "";
    const lines: string[] = [];
    lines.push(productName);
    lines.push("");
    lines.push(`Ingredienser: ${text}`);
    if (computed.allergens_contains.length) lines.push(`Inneholder: ${computed.allergens_contains.join(", ")}.`);
    if (computed.allergens_may_contain.length) lines.push(`Kan inneholde spor av: ${computed.allergens_may_contain.join(", ")}.`);
    lines.push("");
    lines.push("Næring pr 100 g:");
    for (const f of NUTRITION_FIELDS) {
      const v = (computed.nutrition_per_100g as any)?.[f.key];
      if (v != null) lines.push(`  ${f.label}: ${v}`);
    }
    return lines.join("\n");
  }
  function copyText() { navigator.clipboard.writeText(plainText()); toast.success("Kopiert til utklippstavle"); }
  function printNow() {
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<pre style="font-family:Inter,system-ui;font-size:12px;white-space:pre-wrap;padding:16px">${plainText().replace(/</g, "&lt;")}</pre>`);
    w.document.close();
    w.print();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Etikett-forhåndsvisning</DialogTitle></DialogHeader>
        <div className="rounded-md border border-border bg-background p-4 text-sm space-y-2">
          <div className="font-semibold">{productName}</div>
          <div>
            <span className="font-medium">Ingredienser: </span>
            <span dangerouslySetInnerHTML={{ __html: computed.ingredient_declaration_html || "—" }} />
          </div>
          {computed.allergens_contains.length > 0 && (
            <div><span className="font-medium">Inneholder:</span> {computed.allergens_contains.join(", ")}.</div>
          )}
          {computed.allergens_may_contain.length > 0 && (
            <div><span className="font-medium">Kan inneholde spor av:</span> {computed.allergens_may_contain.join(", ")}.</div>
          )}
          <div className="pt-2">
            <div className="font-medium">Næringsinnhold pr 100 g:</div>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {NUTRITION_FIELDS.map((f) => {
                  const v = (computed.nutrition_per_100g as any)?.[f.key];
                  if (v == null) return null;
                  return <tr key={f.key}><td className="py-0.5">{f.label}</td><td className="py-0.5 text-right tabular-nums">{v}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={copyText}><Copy className="mr-1.5 h-4 w-4" /> Kopier tekst</Button>
          <Button variant="outline" onClick={printNow}><Printer className="mr-1.5 h-4 w-4" /> Skriv ut</Button>
          <Button onClick={onClose}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ComputedDeclaration = {
  mode: Mode;
  mode_source: "link" | "recipe" | "default";
  product_recipe_link_id: string;
  product_id: string;
  recipe_id: string;
  product_name: string;
  total_input_grams: number;
  final_weight_grams: number;
  ingredient_declaration_html: string;
  nutrition_per_100g: Record<string, number | null>;
  allergens_contains: string[];
  allergens_may_contain: string[];
  data_quality: {
    lines_total: number;
    master_lines: number;
    extra_lines: number;
    master_lines_without_raw_material: number;
    extra_lines_without_raw_material: number;
    master_lines_without_nutrition: number;
    extra_lines_without_nutrition: number;
    nutrition_coverage_pct: number;
    yield_grams_set: boolean;
  };
  warnings: string[];
  computed_lines: Array<{
    source: "master" | "extra";
    name: string;
    grams: number;
    effective_grams: number;
    include: boolean;
    is_quid: boolean;
    raw_material_id: string | null;
    has_nutrition: boolean;
  }>;
};
