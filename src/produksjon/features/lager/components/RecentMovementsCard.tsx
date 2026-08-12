import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { showError } from "@/lib/userError";
import {
  MOVEMENT_LABELS,
  useStockAdjust,
  useTodayStockMovements,
  type LagerItem,
  type StockMovementRow,
} from "../hooks/useLager";

interface Props {
  legalEntityId: string | undefined;
  /** Lagervarer som er synlige for valgt avdeling — bevegelser filtreres på disse. */
  items: LagerItem[];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

export function RecentMovementsCard({ legalEntityId, items }: Props) {
  const { data: movements = [], isLoading } = useTodayStockMovements(legalEntityId);
  const adjust = useStockAdjust();
  const [pending, setPending] = useState<StockMovementRow | null>(null);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const visible = useMemo(
    () => movements.filter((m) => itemMap.has(m.stock_item_id)),
    [movements, itemMap],
  );

  const doUndo = async () => {
    const m = pending;
    if (!m) return;
    try {
      await adjust.mutateAsync({
        stock_item_id: m.stock_item_id,
        delta: -m.quantity_base,
        kind: "correction",
        reason: `Angret: ${MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}`,
        batch_id: m.batch_id ?? undefined,
        note: m.note ?? undefined,
      });
      toast.success("Bevegelsen er angret");
      setPending(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg) toast.error(msg);
      else showError(e, "Kunne ikke angre bevegelsen");
    }
  };

  if (!isLoading && visible.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Siste bevegelser i dag</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">Laster …</p>
          ) : (
            visible.slice(0, 20).map((m) => {
              const item = itemMap.get(m.stock_item_id);
              const positive = m.quantity_base > 0;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-md border border-line-subtle px-3 py-2"
                >
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                    {fmtTime(m.occurred_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item?.name ?? "—"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                    {m.batch_number ? ` · ${m.batch_number}` : ""}
                  </span>
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right font-mono text-sm tabular-nums",
                      positive ? "text-success" : "text-destructive",
                    )}
                  >
                    {positive ? "+" : ""}
                    {m.quantity_base.toLocaleString("nb-NO")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 shrink-0"
                    onClick={() => setPending(m)}
                  >
                    <Undo2 className="mr-1 h-4 w-4" />
                    Angre
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Angre bevegelsen?</AlertDialogTitle>
            <AlertDialogDescription>
              Det føres en motsatt korrigering på{" "}
              {pending ? (-pending.quantity_base).toLocaleString("nb-NO") : ""}{" "}
              for {pending ? itemMap.get(pending.stock_item_id)?.name ?? "lagervaren" : ""}. Den
              opprinnelige bevegelsen blir stående i historikken.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={adjust.isPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doUndo();
              }}
              disabled={adjust.isPending}
            >
              {adjust.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Angre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
