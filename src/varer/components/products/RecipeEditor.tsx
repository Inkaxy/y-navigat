import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { logAudit } from "@/varer/lib/audit";
import { toast } from "sonner";

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

export function RecipeEditor({ productId, productName, canWrite }: Props) {
  const qc = useQueryClient();

  const recipeQuery = useQuery({
    queryKey: ["recipe", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select("*, recipe_lines(*)")
        .eq("product_id", productId)
        .is("valid_to", null)
        .maybeSingle();
      return data;
    },
  });

  const recipe = recipeQuery.data;
  const [creating, setCreating] = useState(false);

  async function createRecipe() {
    setCreating(true);
    const { data, error } = await supabase
      .from("recipes")
      .insert({ product_id: productId, yield_quantity: 1, yield_unit: "stk" } as never)
      .select()
      .single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "create", entity_type: "recipe", entity_id: data.id, entity_display_reference: productName });
    qc.invalidateQueries({ queryKey: ["recipe", productId] });
    toast.success("Oppskrift opprettet");
  }

  if (recipeQuery.isLoading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!recipe) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Ingen aktiv oppskrift for denne varen ennå.</p>
          {canWrite && (
            <Button onClick={createRecipe} disabled={creating} className="bg-app hover:bg-app-dark text-app-foreground">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Opprett oppskrift
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return <RecipeForm recipe={recipe} productName={productName} canWrite={canWrite} />;
}

function RecipeForm({ recipe, productName, canWrite }: { recipe: any; productName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [yieldQty, setYieldQty] = useState(String(recipe.yield_quantity));
  const [yieldUnit, setYieldUnit] = useState(recipe.yield_unit);
  const [notes, setNotes] = useState(recipe.notes ?? "");
  const [lines, setLines] = useState<any[]>(
    (recipe.recipe_lines ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order),
  );
  const [saving, setSaving] = useState(false);

  function addLine() {
    setLines([...lines, { _new: true, ingredient_name: "", quantity: "", unit: "g", waste_percent: 0, sort_order: lines.length }]);
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, key: string, val: any) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));
  }

  async function save() {
    setSaving(true);
    const { error: e1 } = await supabase
      .from("recipes")
      .update({ yield_quantity: Number(yieldQty) || 1, yield_unit: yieldUnit, notes: notes || null })
      .eq("id", recipe.id);
    if (e1) { setSaving(false); toast.error(e1.message); return; }

    // Slett gamle linjer som ikke lenger er i listen
    const existingIds = lines.filter((l) => !l._new && l.id).map((l) => l.id);
    const originalIds = (recipe.recipe_lines ?? []).map((l: any) => l.id);
    const toDelete = originalIds.filter((id: string) => !existingIds.includes(id));
    if (toDelete.length) {
      await supabase.from("recipe_lines").delete().in("id", toDelete);
    }

    // Upsert / insert / update
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const payload = {
        recipe_id: recipe.id,
        ingredient_name: l.ingredient_name,
        quantity: Number(l.quantity) || 0,
        unit: l.unit,
        waste_percent: Number(l.waste_percent) || 0,
        sort_order: i,
        notes: l.notes ?? null,
      };
      if (!payload.ingredient_name || payload.quantity <= 0) continue;
      if (l._new || !l.id) {
        await supabase.from("recipe_lines").insert(payload as never);
      } else {
        await supabase.from("recipe_lines").update(payload).eq("id", l.id);
      }
    }
    setSaving(false);
    await logAudit({
      action: "update",
      entity_type: "recipe",
      entity_id: recipe.id,
      entity_display_reference: productName,
      changes: { yield_quantity: yieldQty, yield_unit: yieldUnit, line_count: lines.length },
    });
    toast.success("Oppskrift lagret");
    qc.invalidateQueries({ queryKey: ["recipe", recipe.product_id] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aktiv oppskrift (v{recipe.version})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <div>
            <Label>Utbytte</Label>
            <Input type="number" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} disabled={!canWrite} />
          </div>
          <div>
            <Label>Enhet</Label>
            <Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} disabled={!canWrite} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Ingredienser</Label>
            {canWrite && (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Legg til
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {lines.length === 0 && (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                Ingen ingredienser. Klikk «Legg til».
              </div>
            )}
            {lines.map((l, i) => (
              <div key={l.id ?? `new-${i}`} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-5">
                  <Input placeholder="Ingrediens (fri tekst)" value={l.ingredient_name} onChange={(e) => updateLine(i, "ingredient_name", e.target.value)} disabled={!canWrite} />
                </div>
                <div className="col-span-2">
                  <Input type="number" step="any" placeholder="Mengde" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} disabled={!canWrite} />
                </div>
                <div className="col-span-2">
                  <Input placeholder="Enhet" value={l.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} disabled={!canWrite} />
                </div>
                <div className="col-span-2">
                  <Input type="number" step="any" placeholder="Svinn %" value={l.waste_percent ?? 0} onChange={(e) => updateLine(i, "waste_percent", e.target.value)} disabled={!canWrite} />
                </div>
                {canWrite && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} className="col-span-1">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>Notater</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} />
        </div>

        {canWrite && (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="bg-app hover:bg-app-dark text-app-foreground">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre oppskrift
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
