import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { costPerKg, makeSku } from "@/varer/lib/halvfabrikat";
import type { BakersLine } from "@/varer/lib/bakers";

const BASE_UNITS = ["kg", "g", "liter", "ml", "stk"];

export interface CompositeRawMaterial {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  base_unit: string;
  current_cost_price: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipeId: string;
  recipeName: string;
  legalEntityId: string | null;
  lines: BakersLine[];
  existing: CompositeRawMaterial | null;
}

export function SaveAsRawMaterialDialog({
  open, onOpenChange, recipeId, recipeName, legalEntityId, lines, existing,
}: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(recipeName);
  const [category, setCategory] = useState("Halvfabrikat");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? recipeName);
    setCategory(existing?.category ?? "Halvfabrikat");
    setBaseUnit(existing?.base_unit ?? "kg");
  }, [open, recipeName, existing]);

  const price = costPerKg(lines);

  /** Råvare med samme navn som ennå ikke er koblet til en oppskrift. */
  const matchQuery = useQuery({
    queryKey: ["rm-name-match", legalEntityId, name.trim().toLowerCase()],
    enabled: open && !existing && !!legalEntityId && name.trim().length > 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, base_unit, current_cost_price, produced_by_recipe_id")
        .eq("legal_entity_id", legalEntityId!)
        .ilike("name", name.trim())
        .is("produced_by_recipe_id", null)
        .limit(1);
      return ((data ?? [])[0] ?? null) as (CompositeRawMaterial & { produced_by_recipe_id: string | null }) | null;
    },
  });
  const nameMatch = matchQuery.data ?? null;

  async function finish(msg: string) {
    qc.invalidateQueries({ queryKey: ["recipe-composite", recipeId] });
    qc.invalidateQueries({ queryKey: ["raw_materials_autocomplete"] });
    qc.invalidateQueries({ queryKey: ["raw_materials"] });
    qc.invalidateQueries({ queryKey: ["rm-bakers-map"] });
    toast.success(msg);
    onOpenChange(false);
  }

  async function save(linkToId?: string) {
    if (!name.trim()) return toast.error("Navn er påkrevd");
    if (!legalEntityId) return toast.error("Mangler selskap");
    setSaving(true);
    try {
      const targetId = linkToId ?? existing?.id;
      if (targetId) {
        const { error } = await supabase
          .from("raw_materials")
          .update({
            name: name.trim(),
            category: category || null,
            base_unit: baseUnit,
            is_composite: true,
            produced_by_recipe_id: recipeId,
            ...(price != null ? { current_cost_price: price, price_source: "recipe", price_updated_at: new Date().toISOString() } : {}),
          } as never)
          .eq("id", targetId);
        if (error) throw error;
        await finish(linkToId ? "Koblet til eksisterende råvare" : "Oppdatert");
      } else {
        const { error } = await supabase
          .from("raw_materials")
          .insert({
            legal_entity_id: legalEntityId,
            sku: makeSku(name),
            name: name.trim(),
            category: category || null,
            base_unit: baseUnit,
            is_active: true,
            is_packaging: false,
            is_composite: true,
            produced_by_recipe_id: recipeId,
            current_cost_price: price,
            price_source: price != null ? "recipe" : null,
            price_updated_at: price != null ? new Date().toISOString() : null,
          } as never);
        if (error) throw error;
        await finish("Lagret som råvare");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lagre oppskriften som råvare</DialogTitle>
          <DialogDescription>
            Halvfabrikatet blir tilgjengelig som ingrediens i andre oppskrifter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Navn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kategori</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <Label>Enhet</Label>
              <Select value={baseUnit} onValueChange={setBaseUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Beregnet kostpris:{" "}
            <b className="text-foreground tabular-nums">
              {price != null ? `${price.toFixed(2).replace(".", ",")} kr/kg` : "—"}
            </b>
          </p>

          {nameMatch && (
            <div className="rounded-md border border-app/40 bg-app/[0.06] p-3 text-sm">
              <p className="mb-2">
                Det finnes allerede en råvare som heter «{nameMatch.name}» uten oppskriftskobling.
              </p>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => save(nameMatch.id)}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Koble til eksisterende råvare «{nameMatch.name}»
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Oppdater råvare" : "Opprett råvare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
