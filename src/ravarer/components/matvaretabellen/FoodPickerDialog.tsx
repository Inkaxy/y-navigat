import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useApplyMatvaretabellen, useMatvaretabellenFoods } from "@/ravarer/hooks/useMatvaretabellen";
import { formatNumber } from "@/ravarer/lib/constants";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawMaterialId: string;
  initialQuery?: string;
}

/** Velg en matvare for en kjent råvare (motsatt vei av LinkRawMaterialDialog). */
export function FoodPickerDialog({ open, onOpenChange, rawMaterialId, initialQuery }: Props) {
  const { data: foods = [], isLoading } = useMatvaretabellenFoods();
  const apply = useApplyMatvaretabellen();
  const [q, setQ] = useState(initialQuery ?? "");
  const debounced = useDebouncedValue(q, 250);

  useEffect(() => {
    if (open) setQ(initialQuery ?? "");
  }, [open, initialQuery]);

  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle) return foods.slice(0, 50);
    return foods
      .filter(
        (f) =>
          f.food_name.toLowerCase().includes(needle) ||
          (f.search_keywords ?? []).some((k) => k.toLowerCase().includes(needle)),
      )
      .slice(0, 100);
  }, [foods, debounced]);

  return (
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
            onChange={(e) => setQ(e.target.value)}
            placeholder="Søk matvare…"
            className="h-11 pl-9"
          />
        </div>

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
                disabled={apply.isPending}
                onClick={async () => {
                  await apply.mutateAsync({ rawMaterialId, foodId: f.food_id });
                  onOpenChange(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted ${
                  i % 2 === 1 ? "bg-muted/30" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{f.food_name}</div>
                  <div className="truncate text-xs text-ink-secondary">{f.food_group_name ?? "—"}</div>
                </div>
                <div className="shrink-0 text-xs tabular-nums text-ink-secondary">
                  {f.energy_kcal == null ? "—" : `${formatNumber(f.energy_kcal, 0)} kcal`}
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
  );
}
