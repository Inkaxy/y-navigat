import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useApplyMatvaretabellen, useMatvaretabellenLinks } from "@/ravarer/hooks/useMatvaretabellen";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  foodId: string;
  foodName: string;
  /** Forhåndsutfylt søk, f.eks. råvarens navn. */
  initialQuery?: string;
  onLinked?: (rawMaterialId: string) => void;
}

export function LinkRawMaterialDialog({ open, onOpenChange, foodId, foodName, initialQuery, onLinked }: Props) {
  const { data: rows = [], isLoading } = useRawMaterials();
  const { data: suppliers = [] } = useSuppliers();
  const apply = useApplyMatvaretabellen();

  const [q, setQ] = useState(initialQuery ?? "");
  const debounced = useDebouncedValue(q, 250);
  const [pending, setPending] = useState<{ id: string; name: string; source: string } | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQ(initialQuery ?? "");
  }, [open, initialQuery]);

  const supplierMap = useMemo(() => new Map(suppliers.map((s: any) => [s.id, s.name])), [suppliers]);

  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    return rows
      .filter((r) => r.is_active)
      .filter((r) => !needle || `${r.name} ${r.sku} ${r.category ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 100);
  }, [rows, debounced]);

  const link = async (rawMaterialId: string) => {
    try {
      await apply.mutateAsync({ rawMaterialId, foodId });
      onLinked?.(rawMaterialId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke hente næringsverdier");
    }
  };

  const choose = async (rawMaterialId: string, name: string) => {
    setCheckingId(rawMaterialId);
    try {
      const { data, error } = await supabase
        .from("raw_material_nutrition")
        .select("source, matvaretabellen_food_id")
        .eq("raw_material_id", rawMaterialId)
        .maybeSingle();
      if (error) throw error;
      const existingFoodId = (data as any)?.matvaretabellen_food_id ?? null;
      if (data && existingFoodId !== foodId) {
        setPending({ id: rawMaterialId, name, source: (data as any).source || "ukjent" });
        return;
      }
      await link(rawMaterialId);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke sjekke eksisterende næringsdata");
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Koble «{foodName}» til råvare</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk råvare på navn, SKU eller kategori…"
              className="h-11 pl-9"
            />
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line-subtle">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-ink-secondary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-secondary">Ingen aktive råvarer matcher søket.</p>
            ) : (
              visible.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => choose(r.id, r.name)}
                  disabled={!!checkingId || apply.isPending}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted ${
                    i % 2 === 1 ? "bg-muted/30" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-xs text-ink-secondary">
                      {r.sku}
                      {r.category ? ` · ${r.category}` : ""}
                      {r.primary_supplier_id && supplierMap.get(r.primary_supplier_id)
                        ? ` · ${supplierMap.get(r.primary_supplier_id)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{r.base_unit}</Badge>
                    {checkingId === r.id && <Loader2 className="h-4 w-4 animate-spin" />}
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
              «{pending?.name}» har allerede næringsdata (kilde: {pending?.source}). Verdiene overskrives med tall fra
              Matvaretabellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const id = pending?.id;
                setPending(null);
                if (id) await link(id);
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
