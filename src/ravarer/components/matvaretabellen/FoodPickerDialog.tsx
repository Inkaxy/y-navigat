import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useApplyMatvaretabellen, useMatvaretabellenFoods } from "@/ravarer/hooks/useMatvaretabellen";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { formatNumber } from "@/ravarer/lib/constants";
import { rankBySearch } from "@/lib/textSimilarity";
import { suggestDeclarationNameLocal } from "@/ravarer/lib/declarationName";
import { nutritionSourceLabel } from "@/ravarer/lib/nutritionSource";
import { suggestFoods } from "@/ravarer/lib/foodSuggestions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawMaterialId: string;
  /** Overstyrer forhåndsutfyllingen. Uten denne brukes deklarasjonsnavnet. */
  initialQuery?: string;
}

/** Velg en matvare for en kjent råvare (motsatt vei av LinkRawMaterialDialog). */
export function FoodPickerDialog({ open, onOpenChange, rawMaterialId, initialQuery }: Props) {
  const { data: foods = [], isLoading } = useMatvaretabellenFoods();
  const { data: rm } = useRawMaterial(rawMaterialId);
  const apply = useApplyMatvaretabellen();

  // Hele innkjøpsnavnet («REGAL HVETEMEL INDUSTRI 25KG») treffer aldri.
  // Vi starter derfor på deklarasjonsnavnet, eller navnet renset for merke og pakning.
  const defaultQuery = useMemo(() => {
    if (initialQuery !== undefined) return initialQuery;
    const decl = rm?.declaration_name?.trim();
    if (decl) return decl;
    return suggestDeclarationNameLocal(rm?.name ?? "") || (rm?.name ?? "");
  }, [initialQuery, rm?.declaration_name, rm?.name]);

  const [q, setQ] = useState(defaultQuery);
  const [touched, setTouched] = useState(false);
  const debounced = useDebouncedValue(q, 250);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ foodId: string; foodName: string; source: string } | null>(null);

  useEffect(() => {
    if (open) {
      setQ(defaultQuery);
      setTouched(false);
    }
  }, [open, defaultQuery]);

  const suggestions = useMemo(
    () => (rm ? suggestFoods({ name: rm.name, declaration_name: rm.declaration_name, category: rm.category }, foods, 3) : []),
    [rm, foods],
  );
  const suggestionIds = useMemo(() => new Set(suggestions.map((s) => s.food_id)), [suggestions]);

  const visible = useMemo(() => {
    const needle = debounced.trim();
    if (!needle) return foods.slice(0, 50);
    return rankBySearch(foods, needle, (f) => [f.food_name, ...(f.search_keywords ?? [])]).slice(0, 100);
  }, [foods, debounced]);

  const link = async (foodId: string) => {
    try {
      await apply.mutateAsync({ rawMaterialId, foodId });
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke hente næringsverdier");
    }
  };

  const choose = async (foodId: string) => {
    setCheckingId(foodId);
    try {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("source, matvaretabellen_food_id")
        .eq("raw_material_id", rawMaterialId)
        .maybeSingle();
      if (error) throw error;
      const existingFoodId = data?.matvaretabellen_food_id ?? null;
      if (data && existingFoodId !== foodId) {
        const foodName = foods.find((f) => f.food_id === foodId)?.food_name ?? "valgt matvare";
        setPending({ foodId, foodName, source: nutritionSourceLabel(data.source) });
        return;
      }
      await link(foodId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke sjekke eksisterende næringsdata");
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Finn i Matvaretabellen</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setTouched(true);
              }}
              placeholder="Søk matvare…"
              className="h-11 pl-9"
            />
          </div>

          {!touched && suggestions.length > 0 && (
            <div className="rounded-lg border border-line-subtle p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-secondary">Forslag</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button
                    key={s.food_id}
                    variant="outline"
                    size="sm"
                    disabled={!!checkingId || apply.isPending}
                    onClick={() => choose(s.food_id)}
                  >
                    {s.food_name}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {Math.round(s.confidence * 100)} %
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line-subtle">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-ink-secondary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-secondary">Ingen matvarer matcher søket.</p>
            ) : (
              visible.map((f, i) => (
                <button
                  key={f.food_id}
                  disabled={!!checkingId || apply.isPending}
                  onClick={() => choose(f.food_id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted ${
                    i % 2 === 1 ? "bg-muted/30" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{f.food_name}</span>
                      {suggestionIds.has(f.food_id) && (
                        <Badge variant="secondary" className="text-[10px]">
                          Foreslått
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-secondary">{f.food_group_name ?? "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-ink-secondary">
                    {f.energy_kcal == null ? "—" : `${formatNumber(f.energy_kcal, 0)} kcal`}
                    {checkingId === f.food_id && <Loader2 className="h-4 w-4 animate-spin" />}
                  </div>
                </button>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overskrive næringsdata?</AlertDialogTitle>
            <AlertDialogDescription>
              Råvaren har allerede næringsdata (kilde: {pending?.source}). Verdiene overskrives med tall fra «
              {pending?.foodName}» i Matvaretabellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const foodId = pending?.foodId;
                setPending(null);
                if (foodId) await link(foodId);
              }}
            >
              Overskriv
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
