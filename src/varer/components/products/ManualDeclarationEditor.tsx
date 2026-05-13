import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/varer/lib/audit";

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
  /** Vis intro-tekst om at det ikke finnes oppskrift. */
  showStandaloneIntro?: boolean;
}

export function ManualDeclarationEditor({
  productId,
  productName,
  canWrite,
  showStandaloneIntro = true,
}: Props) {
  const qc = useQueryClient();
  const productQuery = useQuery({
    queryKey: ["product-manual-decl", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, manual_ingredient_declaration, manual_allergens_contains, manual_allergens_may_contain, manual_nutrition_per_100g, manual_declaration_updated_at",
        )
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [ingredient, setIngredient] = useState("");
  const [contains, setContains] = useState("");
  const [mayContain, setMayContain] = useState("");
  const [nutrition, setNutrition] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUTRITION_FIELDS.map((f) => [f.key, ""])),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = productQuery.data;
    if (!d) return;
    setIngredient(d.manual_ingredient_declaration ?? "");
    setContains((d.manual_allergens_contains ?? []).join(", "));
    setMayContain((d.manual_allergens_may_contain ?? []).join(", "));
    const nut = (d.manual_nutrition_per_100g ?? {}) as Record<string, number>;
    setNutrition(
      Object.fromEntries(
        NUTRITION_FIELDS.map((f) => [f.key, nut[f.key] != null ? String(nut[f.key]) : ""]),
      ),
    );
  }, [productQuery.data]);

  async function save() {
    setSaving(true);
    const nut: Record<string, number> = {};
    for (const f of NUTRITION_FIELDS) {
      const v = nutrition[f.key];
      if (v !== "" && Number.isFinite(Number(v))) nut[f.key] = Number(v);
    }
    const payload = {
      manual_ingredient_declaration: ingredient.trim() || null,
      manual_allergens_contains: contains
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      manual_allergens_may_contain: mayContain
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      manual_nutrition_per_100g: Object.keys(nut).length ? nut : null,
      manual_declaration_updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("products").update(payload).eq("id", productId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "update",
      entity_type: "product",
      entity_id: productId,
      entity_display_reference: productName,
      changes: { manual_declaration: true },
    });
    toast.success("Manuell deklarasjon lagret");
    qc.invalidateQueries({ queryKey: ["product-manual-decl", productId] });
    qc.invalidateQueries({ queryKey: ["product-info", productId] });
  }

  if (productQuery.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showStandaloneIntro && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 py-4">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Ingen oppskrift er koblet til dette produktet. Du kan likevel legge inn en manuell deklarasjon her —
              den vises i produktinfo og på etiketter inntil en oppskrift kobles til.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingrediensdeklarasjon</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={ingredient}
            disabled={!canWrite}
            onChange={(e) => setIngredient(e.target.value)}
            placeholder="Hvetemel, vann, salt, gjær, …"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Merk allergener manuelt med <code>&lt;strong&gt;hvete&lt;/strong&gt;</code> for fet skrift.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allergener</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Inneholder (kommaseparert)</Label>
            <Input
              value={contains}
              disabled={!canWrite}
              onChange={(e) => setContains(e.target.value)}
              placeholder="hvete, melk, egg"
            />
          </div>
          <div>
            <Label className="text-xs">Kan inneholde spor av (kommaseparert)</Label>
            <Input
              value={mayContain}
              disabled={!canWrite}
              onChange={(e) => setMayContain(e.target.value)}
              placeholder="nøtter, sesam"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Næringsinnhold pr 100 g</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {NUTRITION_FIELDS.map((f) => (
                <tr key={f.key} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5">{f.label}</td>
                  <td className="py-1.5 text-right">
                    <Input
                      type="number"
                      step="0.1"
                      value={nutrition[f.key]}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setNutrition((s) => ({ ...s, [f.key]: e.target.value }))
                      }
                      className="ml-auto h-8 w-32 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Lagre manuell deklarasjon
          </Button>
        </div>
      )}
    </div>
  );
}
