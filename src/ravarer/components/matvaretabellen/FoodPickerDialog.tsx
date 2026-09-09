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
import {
  useApplyMatvaretabellen,
  useMatvaretabellenSearch,
  useMatvaretabellenSuggest,
  useMatvaretabellenSuggestForName,
} from "@/ravarer/hooks/useMatvaretabellen";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { suggestDeclarationNameLocal } from "@/ravarer/lib/declarationName";
import { nutritionSourceLabel } from "@/ravarer/lib/nutritionSource";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawMaterialId: string;
  /** Overstyrer forhåndsutfyllingen. Uten denne brukes deklarasjonsnavnet. */
  initialQuery?: string;
}

/** Velg en matvare for en kjent råvare (motsatt vei av LinkRawMaterialDialog). */
export function FoodPickerDialog({ open, onOpenChange, rawMaterialId, initialQuery }: Props) {
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
  const [skippedInfo, setSkippedInfo] = useState<{ foodId: string; count: number } | null>(null);

  useEffect(() => {
    if (open) {
      setQ(defaultQuery);
      setTouched(false);
      setSkippedInfo(null);
    }
  }, [open, defaultQuery]);

  // Råvaren er lagret — bruk den presise suggest-en, som rangeres i databasen.
  // Er råvaren fortsatt ulagret (ikke funnet ennå), foreslår vi ut fra teksten alene.
  const { data: suggestKnown = [] } = useMatvaretabellenSuggest(rm ? rawMaterialId : null);
  const { data: suggestForName = [] } = useMatvaretabellenSuggestForName(
    rm ? null : { name: q, declarationName: null, category: null },
  );
  const suggestions = (rm ? suggestKnown : suggestForName).slice(0, 5);
  const suggestionIds = useMemo(() => new Set(suggestions.map((s) => s.food_id)), [suggestions]);

  const { data: searchResults = [], isFetching: searching } = useMatvaretabellenSearch(debounced);
  const visible = searchResults;

  const link = async (foodId: string, force?: boolean) => {
    try {
      const res = await apply.mutateAsync({ rawMaterialId, foodId, force });
      if (!force && (res.result?.skipped?.length ?? 0) > 0) {
        setSkippedInfo({ foodId, count: res.result!.skipped.length });
        return;
      }
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
        const foodName = visible.find((f) => f.food_id === foodId)?.food_name
          ?? suggestions.find((s) => s.food_id === foodId)?.food_name
          ?? "valgt matvare";
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
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-secondary">Foreslått</div>
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
                    {s.food_group_name && (
                      <span className="ml-1.5 text-ink-secondary">· {s.food_group_name}</span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {Math.round(s.score * 100)} %
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line-subtle">
            {searching ? (
              <div className="flex items-center justify-center p-8 text-ink-secondary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : debounced.trim().length < 2 ? (
              <p className="p-6 text-center text-sm text-ink-secondary">Skriv minst to tegn for å søke.</p>
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

      <AlertDialog open={!!skippedInfo} onOpenChange={(v) => !v && setSkippedInfo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Noen felt ble beholdt</AlertDialogTitle>
            <AlertDialogDescription>
              {skippedInfo?.count} felt beholdt fra datablad/manuell, fordi de kommer fra en kilde vi ikke
              overskriver automatisk. Du kan overskrive dem likevel med tallene fra Matvaretabellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onOpenChange(false)}>Behold</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const foodId = skippedInfo?.foodId;
                setSkippedInfo(null);
                if (foodId) await link(foodId, true);
              }}
            >
              Overskriv likevel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
