import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MinusCircle, PlusCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

import {
  applyDiff,
  clearPageSource,
  computeDiff,
  fetchExistingProductButtons,
  fetchGroupProducts,
  fetchSourceGroups,
  SOURCE_KIND_LABEL,
  type SourceKind,
} from "@/pos_styring/keypad/dynamicPages";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: string;
  legalEntityId: string;
  pageId: string;
  pageName: string;
  gridCols: number;
  gridRows: number;
  initialKind?: SourceKind | null;
  initialSourceId?: string | null;
  initialIsDynamic?: boolean;
}

export function FillFromCategoryDialog({
  open,
  onOpenChange,
  layoutId,
  legalEntityId,
  pageId,
  pageName,
  gridCols,
  gridRows,
  initialKind,
  initialSourceId,
  initialIsDynamic,
}: Props) {
  const [kind, setKind] = useState<SourceKind>(initialKind ?? "main_category");
  const [sourceId, setSourceId] = useState<string | null>(initialSourceId ?? null);
  const [dynamic, setDynamic] = useState<boolean>(initialIsDynamic ?? true);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setKind(initialKind ?? "main_category");
      setSourceId(initialSourceId ?? null);
      setDynamic(initialIsDynamic ?? true);
    }
  }, [open, initialKind, initialSourceId, initialIsDynamic]);

  const groupsQuery = useQuery({
    queryKey: ["keypad-source-groups", legalEntityId, kind],
    queryFn: () => fetchSourceGroups(legalEntityId, kind),
    enabled: open,
  });

  const productsQuery = useQuery({
    queryKey: ["keypad-source-products", legalEntityId, kind, sourceId],
    queryFn: () => fetchGroupProducts(legalEntityId, kind, sourceId!),
    enabled: open && !!sourceId,
  });

  const existingQuery = useQuery({
    queryKey: ["keypad-existing-products", pageId],
    queryFn: () => fetchExistingProductButtons(pageId),
    enabled: open,
  });

  const diff = useMemo(() => {
    if (!productsQuery.data || !existingQuery.data) return null;
    return computeDiff(existingQuery.data, productsQuery.data);
  }, [productsQuery.data, existingQuery.data]);

  const capacity = gridCols * gridRows;
  const occupiedNonProduct = (existingQuery.data?.length ?? 0);
  const willFit = diff ? capacity - (occupiedNonProduct - diff.toRemove.length) : capacity;

  const apply = useMutation({
    mutationFn: async () => {
      if (!diff || !sourceId) throw new Error("Velg en gruppe først");
      return applyDiff(diff, {
        layoutId,
        pageId,
        gridCols,
        gridRows,
        kind,
        sourceId,
        markDynamic: dynamic,
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["pos_keypad_buttons", pageId] });
      await qc.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] });
      const skipped = res.skipped > 0 ? ` · ${res.skipped} fikk ikke plass` : "";
      toast.success(`Synket: +${res.added} · −${res.removed}${skipped}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Kunne ikke synke siden"),
  });

  const detach = useMutation({
    mutationFn: () => clearPageSource(pageId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] });
      toast.success("Siden er ikke lenger dynamisk");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Kunne ikke frikoble"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Fyll «{pageName}» fra varegruppe
          </DialogTitle>
          <DialogDescription>
            Velg en gruppe fra varekatalogen. Alle POS-aktive produkter i gruppa blir
            til produktknapper på siden. Funksjonsknapper og kategori-lenker
            beholdes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Type gruppe
            </Label>
            <RadioGroup
              value={kind}
              onValueChange={(v) => {
                setKind(v as SourceKind);
                setSourceId(null);
              }}
              className="mt-2 grid grid-cols-3 gap-2"
            >
              {(Object.keys(SOURCE_KIND_LABEL) as SourceKind[]).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent"
                >
                  <RadioGroupItem value={k} />
                  {SOURCE_KIND_LABEL[k]}
                </label>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              {SOURCE_KIND_LABEL[kind]}
            </Label>
            <Select
              value={sourceId ?? ""}
              onValueChange={(v) => setSourceId(v || null)}
              disabled={groupsQuery.isLoading}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Velg gruppe…" />
              </SelectTrigger>
              <SelectContent>
                {(groupsQuery.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.display_name}
                    {g.code ? ` (${g.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border bg-card p-3">
            <div>
              <div className="text-sm font-medium">Gjør siden dynamisk</div>
              <div className="text-xs text-muted-foreground">
                Ved neste synk oppdateres knappene automatisk når sortimentet i
                gruppa endres.
              </div>
            </div>
            <Switch checked={dynamic} onCheckedChange={setDynamic} />
          </label>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Endringer som vil skje</span>
              {diff && (
                <span>
                  +{diff.toAdd.length} · −{diff.toRemove.length} · ={" "}
                  {diff.toKeep.length} beholdes
                </span>
              )}
            </div>
            {!sourceId ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Velg en gruppe over for å se diff.
              </div>
            ) : productsQuery.isLoading || existingQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : diff ? (
              <ScrollArea className="h-56 pr-3">
                <div className="space-y-2">
                  {diff.toAdd.map((p) => (
                    <div key={`add-${p.id}`} className="flex items-center gap-2 text-sm">
                      <PlusCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{p.pos_display_name ?? p.display_name}</span>
                    </div>
                  ))}
                  {diff.toRemove.map((b) => (
                    <div key={`rm-${b.id}`} className="flex items-center gap-2 text-sm">
                      <MinusCircle className="h-4 w-4 shrink-0 text-destructive" />
                      <span className="line-through decoration-destructive/60">
                        {b.display_label ?? "(uten navn)"}
                      </span>
                    </div>
                  ))}
                  {diff.toAdd.length === 0 && diff.toRemove.length === 0 && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      Siden er allerede synk med gruppa.
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : null}
            {diff && diff.toAdd.length > willFit && (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Grid har plass til {Math.max(0, willFit)} nye knapper. De{" "}
                {diff.toAdd.length - Math.max(0, willFit)} siste hoppes over — utvid
                gridet eller frigjør celler først.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {initialIsDynamic && (
              <Button
                variant="ghost"
                onClick={() => detach.mutate()}
                disabled={detach.isPending}
              >
                Frikoble fra gruppa
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => apply.mutate()}
              disabled={!sourceId || !diff || apply.isPending}
            >
              {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Synk siden
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
