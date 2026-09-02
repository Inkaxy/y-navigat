import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Sparkles, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { logAudit } from "@/varer/lib/audit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  productRecipeLinkId: string;
  onApproved: () => void;
}

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

interface ParsedResult {
  ingredient_declaration: string;
  nutrition_per_100g: Record<string, number>;
  allergens_contains: string[];
  allergens_may_contain: string[];
  confidence?: { ingredient?: number; nutrition?: number; allergens?: number };
  notes?: string;
}

type Stage = "upload" | "parsing" | "review";

export function PdfDeclarationImportDialog({ open, onOpenChange, productId, productName, productRecipeLinkId, onApproved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [meta, setMeta] = useState<{ provider: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Editable felt
  const [ingredientEdit, setIngredientEdit] = useState("");
  const [nutritionEdit, setNutritionEdit] = useState<Record<string, string>>({});
  const [containsEdit, setContainsEdit] = useState("");
  const [mayContainEdit, setMayContainEdit] = useState("");

  function reset() {
    setStage("upload");
    setFilePath(null);
    setResult(null);
    setMeta(null);
    setBusy(false);
    setIngredientEdit("");
    setNutritionEdit({});
    setContainsEdit("");
    setMayContainEdit("");
  }

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Kun PDF er støttet.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("PDF for stor (maks 15 MB).");
      return;
    }
    setBusy(true);
    setStage("parsing");
    try {
      // Hent produktets legal_entity_id for entity-scoped storage path
      const { data: prod, error: prodErr } = await supabase
        .from("products")
        .select("legal_entity_id")
        .eq("id", productId)
        .maybeSingle();
      if (prodErr) throw prodErr;
      if (!prod?.legal_entity_id) throw new Error("Produktet mangler selskap");

      const path = `${prod.legal_entity_id}/${productId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("declaration-uploads")
        .upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      setFilePath(path);

      const { data, error } = await supabase.functions.invoke("parse-declaration-pdf", {
        body: { product_id: productId, file_path: path },
      });
      if (error) throw new Error(error.message);
      if (!data?.success || !data?.result) throw new Error(data?.error ?? "Ukjent feil fra AI");

      const r = data.result as ParsedResult;
      setResult(r);
      setMeta({ provider: data.provider, model: data.model });
      setIngredientEdit(r.ingredient_declaration ?? "");
      const nut: Record<string, string> = {};
      for (const f of NUTRITION_FIELDS) {
        const v = r.nutrition_per_100g?.[f.key];
        nut[f.key] = v != null ? String(v) : "";
      }
      setNutritionEdit(nut);
      setContainsEdit((r.allergens_contains ?? []).join(", "));
      setMayContainEdit((r.allergens_may_contain ?? []).join(", "));
      setStage("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tolking feilet");
      setStage("upload");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const nut: Record<string, number> = {};
      for (const f of NUTRITION_FIELDS) {
        const v = nutritionEdit[f.key];
        if (v !== "" && Number.isFinite(Number(v))) nut[f.key] = Number(v);
      }
      const { error } = await supabase
        .from("product_recipe_links")
        .update({
          declaration_mode: "manual",
          manual_ingredient_declaration: ingredientEdit || null,
          manual_nutrition: Object.keys(nut).length ? (nut as never) : null,
          manual_allergen_summary: {
            contains: containsEdit.split(",").map((s) => s.trim()).filter(Boolean),
            may_contain: mayContainEdit.split(",").map((s) => s.trim()).filter(Boolean),
          } as never,
          declaration_updated_at: new Date().toISOString(),
        })
        .eq("id", productRecipeLinkId);
      if (error) throw error;

      // Oppdater produkt-snapshotet med én gang.
      await syncEffectiveDeclaration(productRecipeLinkId);

      await logAudit({
        action: "ai_declaration_imported",
        entity_type: "product_recipe_link",
        entity_id: productRecipeLinkId,
        entity_display_reference: productName,
        changes: { provider: meta?.provider, model: meta?.model, source_pdf: filePath },
      });

      // Best-effort: slett midlertidig PDF
      if (filePath) {
        await supabase.storage.from("declaration-uploads").remove([filePath]).catch(() => {});
      }

      toast.success("Deklarasjon godkjent og lagret");
      onApproved();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Last opp deklarasjons-PDF
          </DialogTitle>
          <DialogDescription>
            AI tolker PDF-en og foreslår ingredienser, næring og allergener. Du må godkjenne før noe lagres.
          </DialogDescription>
        </DialogHeader>

        {stage === "upload" && (
          <div
            className="rounded-md border-2 border-dashed border-border bg-muted/30 p-8 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          >
            <FileText className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Dra og slipp en PDF her, eller velg fra disk.
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Velg PDF
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
        )}

        {stage === "parsing" && (
          <div className="py-12 text-center space-y-3">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">AI tolker PDF-en … (kan ta 10-30 sek)</p>
          </div>
        )}

        {stage === "review" && result && (
          <div className="space-y-4">
            {meta && (
              <div className="text-xs text-muted-foreground">
                Tolket av <strong>{meta.provider}</strong> / {meta.model}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Ingrediensdeklarasjon</Label>
                {result.confidence?.ingredient != null && (
                  <ConfidenceBadge value={result.confidence.ingredient} />
                )}
              </div>
              <Textarea rows={5} value={ingredientEdit} onChange={(e) => setIngredientEdit(e.target.value)} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Næringsinnhold pr 100 g</Label>
                {result.confidence?.nutrition != null && (
                  <ConfidenceBadge value={result.confidence.nutrition} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
                {NUTRITION_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="flex-1 text-xs">{f.label}</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={nutritionEdit[f.key] ?? ""}
                      onChange={(e) => setNutritionEdit((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="w-24 h-8 text-right text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Allergener</Label>
                {result.confidence?.allergens != null && (
                  <ConfidenceBadge value={result.confidence.allergens} />
                )}
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">Inneholder</span>
                  <Input value={containsEdit} onChange={(e) => setContainsEdit(e.target.value)} placeholder="hvete, melk, egg" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Kan inneholde spor av</span>
                  <Input value={mayContainEdit} onChange={(e) => setMayContainEdit(e.target.value)} placeholder="nøtter, sesam" />
                </div>
              </div>
            </div>

            {result.notes && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">AI-merknader:</strong> {result.notes}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          {stage === "review" && (
            <Button onClick={approve} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Godkjenn og lagre som manuell
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const variant = value >= 0.8 ? "secondary" : value >= 0.5 ? "outline" : "destructive";
  return <Badge variant={variant} className="text-xs">Sikkerhet {pct}%</Badge>;
}
