import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const { data: links, isLoading: linksLoading, isError: linksError } = useMatvaretabellenLinks();
  const apply = useApplyMatvaretabellen();
  const linksUnknown = linksLoading || linksError || !links;
  const alreadyLinked = useMemo(
    () => new Set((links?.get(foodId) ?? []).map((l) => l.raw_material_id)),
    [links, foodId],
  );


  const [q, setQ] = useState(initialQuery ?? "");
  const debounced = useDebouncedValue(q, 250);
  const [pending, setPending] = useState<{ id: string; name: string; source: string } | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [linkedNow, setLinkedNow] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQ(initialQuery ?? "");
      setLinkedNow([]);
    }
  }, [open, initialQuery]);

  const supplierMap = useMemo(() => new Map(suppliers.map((s: { id: string; name: string }) => [s.id, s.name])), [suppliers]);

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
      setLinkedNow((prev) => (prev.includes(rawMaterialId) ? prev : [...prev, rawMaterialId]));
      onLinked?.(rawMaterialId);
      // Dialogen holdes åpen slik at flere råvarer kan kobles til samme matvare.
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke hente næringsverdier");
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
      const existingFoodId = data?.matvaretabellen_food_id ?? null;
      if (data && existingFoodId !== foodId) {
        setPending({ id: rawMaterialId, name, source: data.source || "ukjent" });
        return;
      }
      await link(rawMaterialId);
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
            <DialogTitle>Koble «{foodName}» til råvare</DialogTitle>
            <DialogDescription>
              Velg én eller flere råvarer — vinduet blir stående åpent til du er ferdig.
            </DialogDescription>
          </DialogHeader>

          {linksUnknown && !linksLoading && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Kunne ikke hente eksisterende koblinger — «Allerede koblet» vises ikke.
            </div>
          )}

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
              visible.map((r, i) => {
                const isLinked = alreadyLinked.has(r.id) || linkedNow.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      if (isLinked) return;
                      void choose(r.id, r.name);
                    }}
                    disabled={isLinked || !!checkingId || apply.isPending}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted disabled:cursor-default disabled:opacity-70 ${
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
                      {isLinked && (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                          Allerede koblet
                        </Badge>
                      )}
                      <Badge variant="outline">{r.base_unit}</Badge>
                      {checkingId === r.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <span className="text-sm text-ink-secondary">
              {linkedNow.length > 0
                ? `${linkedNow.length} råvare${linkedNow.length === 1 ? "" : "r"} koblet i denne økten`
                : "Ingen koblinger gjort ennå"}
            </span>
            <Button onClick={() => onOpenChange(false)}>Ferdig</Button>
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
