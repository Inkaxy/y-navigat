import { useEffect, useMemo, useState } from "react";
import { Loader2, Repeat, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";
import { useUpsertRecurringForProduct } from "@/ordre/hooks/useRecurringOrders";

const DAY_LABELS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

function isoDow(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export type WeekEditorColumn = { date: string; tour: MatrixTour };

/**
 * Ukes-editor for én vare: alle dager × turer i visningen, med live ukesum,
 * «Lagre uke» (samme lagringsvei som matrisecellene) og mulighet for å skrive
 * ukens antall inn i kundens fastordre.
 */
export function ProductWeekEditor({
  open,
  onOpenChange,
  product,
  columns,
  customerId,
  scheduleId,
  getValue,
  getGhost,
  onChange,
  onSaveWeek,
  isSaving,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: MatrixProduct | null;
  columns: WeekEditorColumn[];
  customerId: string | null;
  scheduleId?: string | null;
  /** Leser gjeldende (evt. redigert) verdi for en celle. */
  getValue: (date: string, tourId: string, productId: string) => string;
  /** Fastordre-grunnlag (dempet) for cellen, 0 hvis ingen. */
  getGhost?: (date: string, tourId: string, productId: string) => number;
  /** Skriver verdi tilbake til matrisens edit-state. */
  onChange: (date: string, tourId: string, productId: string, value: string) => void;
  /** Lagrer alle ulagrede endringer (matrisens vanlige lagring). */
  onSaveWeek: () => Promise<void> | void;
  isSaving: boolean;
  canEdit: boolean;
}) {
  const upsertRecurring = useUpsertRecurringForProduct();
  const [confirmRecurring, setConfirmRecurring] = useState(false);
  const [local, setLocal] = useState<Record<string, string>>({});

  const dates = useMemo(() => {
    const seen: string[] = [];
    for (const c of columns) if (!seen.includes(c.date)) seen.push(c.date);
    return seen;
  }, [columns]);

  const tours = useMemo(() => {
    const map = new Map<string, MatrixTour>();
    for (const c of columns) map.set(c.tour.id, c.tour);
    return Array.from(map.values()).sort((a, b) => a.tour_number - b.tour_number);
  }, [columns]);

  const columnKeys = useMemo(
    () => new Set(columns.map((c) => `${c.date}|${c.tour.id}`)),
    [columns],
  );

  // Prefill fra matrisens gjeldende verdier hver gang dialogen åpnes.
  useEffect(() => {
    if (!open || !product) return;
    const next: Record<string, string> = {};
    for (const c of columns) {
      next[`${c.date}|${c.tour.id}`] = getValue(c.date, c.tour.id, product.id);
    }
    setLocal(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const num = (v: string | undefined) => Number((v ?? "").replace(",", ".") || 0) || 0;

  const ghostFor = (date: string, tourId: string) =>
    product && getGhost ? getGhost(date, tourId, product.id) || 0 : 0;

  /** Effektiv mengde: eksplisitt verdi hvis satt, ellers fastordre-grunnlaget. */
  const eff = (date: string, tourId: string) => {
    const raw = local[`${date}|${tourId}`];
    if (raw !== undefined && raw !== "") return num(raw);
    return ghostFor(date, tourId);
  };

  const weekTotal = useMemo(
    () => columns.reduce((a, c) => a + eff(c.date, c.tour.id), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [local, columns, product?.id],
  );

  if (!product) return null;

  const setCell = (date: string, tourId: string, value: string) => {
    setLocal((prev) => ({ ...prev, [`${date}|${tourId}`]: value }));
    onChange(date, tourId, product.id, value);
  };

  const handleSaveWeek = async () => {
    await onSaveWeek();
    onOpenChange(false);
  };

  const handleWriteRecurring = async () => {
    if (!customerId) return;
    const byWeekday = new Map<string, { weekday: number; tour_id: string; quantity: number }>();
    for (const c of columns) {
      const qty = eff(c.date, c.tour.id);
      if (qty <= 0) continue;
      const wd = isoDow(c.date);
      byWeekday.set(`${wd}|${c.tour.id}`, { weekday: wd, tour_id: c.tour.id, quantity: qty });
    }
    try {
      const res = await upsertRecurring.mutateAsync({
        customerId,
        productId: product.id,
        scheduleId: scheduleId ?? null,
        items: Array.from(byWeekday.values()),
      });
      toast.success("Fastordre oppdatert", {
        description: `${res.written} linje(r) lagret for ${product.display_name}.`,
      });
      setConfirmRecurring(false);
    } catch (err) {
      toast.error("Kunne ikke oppdatere fastordre", { description: (err as Error).message });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2 font-display">
              <span className="font-mono text-sm text-muted-foreground tabular-nums">
                {product.display_number}
              </span>
              {product.display_name}
            </DialogTitle>
            <DialogDescription>
              Rediger hele uken for denne varen. Endringene speiles i matrisen.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold">
                    Tur
                  </th>
                  {dates.map((d) => {
                    const dt = new Date(d + "T12:00:00");
                    return (
                      <th
                        key={d}
                        className="border-b border-l border-border px-2 py-2 text-center text-xs font-semibold"
                      >
                        <div>{DAY_LABELS[isoDow(d) - 1]}</div>
                        <div className="font-normal text-muted-foreground tabular-nums">
                          {new Intl.DateTimeFormat("nb-NO", {
                            day: "2-digit",
                            month: "2-digit",
                          }).format(dt)}
                        </div>
                      </th>
                    );
                  })}
                  <th className="border-b border-l border-border px-2 py-2 text-right text-xs font-semibold">
                    Sum
                  </th>
                </tr>
              </thead>
              <tbody>
                {tours.map((t) => {
                  const rowSum = dates.reduce(
                    (a, d) => a + (columnKeys.has(`${d}|${t.id}`) ? eff(d, t.id) : 0),
                    0,
                  );
                  return (
                    <tr key={t.id}>
                      <th
                        scope="row"
                        className="border-b border-border px-3 py-1 text-left text-xs font-medium"
                      >
                        T{t.tour_number}
                        <span className="ml-1 font-normal text-muted-foreground">
                          {t.display_name}
                        </span>
                      </th>
                      {dates.map((d) => {
                        const available = columnKeys.has(`${d}|${t.id}`);
                        return (
                          <td
                            key={d}
                            className={cn(
                              "border-b border-l border-border p-0",
                              !available && "bg-muted/40",
                            )}
                          >
                            {available ? (
                              (() => {
                                const cur = local[`${d}|${t.id}`] ?? "";
                                const ghost = ghostFor(d, t.id);
                                // Fastordre er ordren: vis spøkelsestallet som verdi.
                                const fromFixed = cur === "" && ghost > 0;
                                return (
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    disabled={!canEdit}
                                    value={fromFixed ? String(ghost) : cur}
                                    data-from-fixed={fromFixed ? "true" : undefined}
                                    title={fromFixed ? `Fra fastordre: ${ghost}` : undefined}
                                    onChange={(e) => setCell(d, t.id, e.target.value)}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className={cn(
                                      "h-8 w-full rounded-none border-0 bg-transparent px-2 text-right tabular-nums shadow-none focus-visible:ring-1",
                                      fromFixed && "italic text-muted-foreground",
                                    )}
                                  />
                                );
                              })()
                            ) : (

                              <div className="h-8" />
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-border px-2 text-right text-xs font-semibold tabular-nums">
                        {rowSum || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40">
                  <th className="px-3 py-1.5 text-left text-xs font-semibold">Dagsum</th>
                  {dates.map((d) => {
                    const s = tours.reduce(
                      (a, t) => a + (columnKeys.has(`${d}|${t.id}`) ? eff(d, t.id) : 0),
                      0,
                    );
                    return (
                      <td
                        key={d}
                        className="border-l border-border px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground"
                      >
                        {s || ""}
                      </td>
                    );
                  })}
                  <td className="border-l border-border px-2 py-1.5 text-right text-xs font-bold tabular-nums">
                    {weekTotal || ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-lg border border-brand-bronze/30 bg-brand-bronze/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Fastordre</span> — skriv ukens
                antall inn i kundens faste bestilling for tilsvarende ukedag/tur. Dette påvirker
                alle fremtidige uker.
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!canEdit || !customerId || upsertRecurring.isPending}
                onClick={() => setConfirmRecurring(true)}
              >
                {upsertRecurring.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Repeat className="h-4 w-4" />
                )}
                Oppdater fastordre for denne varen
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Lukk
            </Button>
            <Button onClick={handleSaveWeek} disabled={!canEdit || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lagre uke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRecurring} onOpenChange={setConfirmRecurring}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Oppdatere fastordre?</AlertDialogTitle>
            <AlertDialogDescription>
              Fastordre for «{product.display_name}» erstattes med ukens antall per ukedag og tur.
              Dette gjelder alle fremtidige uker inntil fastordren endres igjen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleWriteRecurring}>Oppdater fastordre</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
