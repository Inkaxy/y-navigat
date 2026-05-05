import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type AdjustOp,
  type RoundTo,
  ROUND_OPTIONS,
  applyAdjustment,
  formatKr,
} from "@/varer/lib/pricing";

export type AdjustTarget = {
  productId: string;
  productName: string;
  priceListId: string;
  priceListName: string;
  current: number | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedProductIds: string[];
  productNames: Record<string, string>;
  priceLists: { id: string; display_name: string }[];
  /** Henter nåværende pris (vare, prisliste). */
  getCurrentPrice: (productId: string, priceListId: string) => number | null;
  /** Kalt med alle endringer som skal anvendes. */
  onApply: (changes: AdjustTarget[], next: Map<string, number>) => Promise<void>;
}

export function BatchAdjustDialog({
  open,
  onOpenChange,
  selectedProductIds,
  productNames,
  priceLists,
  getCurrentPrice,
  onApply,
}: Props) {
  const [pickedListIds, setPickedListIds] = useState<string[]>(() =>
    priceLists.map((p) => p.id),
  );
  const [op, setOp] = useState<AdjustOp>("increase_pct");
  const [amount, setAmount] = useState("5");
  const [round, setRound] = useState<RoundTo>(0.5);
  const [saving, setSaving] = useState(false);

  // Reset listevalg når dialog åpnes
  function handleOpenChange(o: boolean) {
    if (o) {
      setPickedListIds(priceLists.map((p) => p.id));
      setOp("increase_pct");
      setAmount("5");
      setRound(0.5);
    }
    onOpenChange(o);
  }

  const targets = useMemo<AdjustTarget[]>(() => {
    const list: AdjustTarget[] = [];
    for (const productId of selectedProductIds) {
      for (const pl of priceLists) {
        if (!pickedListIds.includes(pl.id)) continue;
        list.push({
          productId,
          productName: productNames[productId] ?? productId,
          priceListId: pl.id,
          priceListName: pl.display_name,
          current: getCurrentPrice(productId, pl.id),
        });
      }
    }
    return list;
  }, [selectedProductIds, priceLists, pickedListIds, productNames, getCurrentPrice]);

  const amt = Number(amount);
  const next = useMemo(() => {
    const m = new Map<string, number>();
    if (isNaN(amt)) return m;
    for (const t of targets) {
      const n = applyAdjustment(t.current, op, amt, round);
      if (n != null && n >= 0) {
        m.set(`${t.productId}::${t.priceListId}`, n);
      }
    }
    return m;
  }, [targets, op, amt, round]);

  const negativeCount = targets.filter((t) => {
    const n = applyAdjustment(t.current, op, amt, round);
    return n != null && n < 0;
  }).length;

  const validChanges = targets.filter((t) => {
    const key = `${t.productId}::${t.priceListId}`;
    const n = next.get(key);
    return n != null && (t.current == null || Math.abs(n - t.current) > 0.001);
  });

  async function handleApply() {
    setSaving(true);
    try {
      await onApply(validChanges, next);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Juster priser</DialogTitle>
          <DialogDescription>
            {selectedProductIds.length} vare(r) × {pickedListIds.length} prisliste(r). Forhåndsvisning vises nedenfor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Prislister</Label>
            <div className="space-y-1.5 rounded-md border border-border p-2 max-h-32 overflow-y-auto">
              {priceLists.map((pl) => (
                <label key={pl.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pickedListIds.includes(pl.id)}
                    onChange={(e) => {
                      setPickedListIds((s) =>
                        e.target.checked ? [...s, pl.id] : s.filter((id) => id !== pl.id),
                      );
                    }}
                  />
                  {pl.display_name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Operasjon</Label>
              <RadioGroup
                value={op}
                onValueChange={(v) => setOp(v as AdjustOp)}
                className="mt-1.5"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="increase_pct" /> Øk med %
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="decrease_pct" /> Reduser med %
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="set" /> Sett pris (kr)
                </label>
              </RadioGroup>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Verdi</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Avrund til</Label>
                <Select
                  value={String(round)}
                  onValueChange={(v) => setRound(Number(v) as RoundTo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROUND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Forhåndsvisning ({validChanges.length} endring(er))</span>
            {negativeCount > 0 && (
              <span className="text-destructive">
                {negativeCount} negativ pris ekskludert
              </span>
            )}
          </div>
          <ScrollArea className="h-64 rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Vare</th>
                  <th className="px-3 py-2 text-left">Prisliste</th>
                  <th className="px-3 py-2 text-right">Før</th>
                  <th className="px-3 py-2 text-right">Etter</th>
                </tr>
              </thead>
              <tbody>
                {targets.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      Velg minst én prisliste.
                    </td>
                  </tr>
                )}
                {targets.map((t) => {
                  const key = `${t.productId}::${t.priceListId}`;
                  const n = next.get(key);
                  const wouldBeNegative =
                    applyAdjustment(t.current, op, amt, round);
                  const isNegative = wouldBeNegative != null && wouldBeNegative < 0;
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="px-3 py-1.5">{t.productName}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {t.priceListName}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {formatKr(t.current)}
                      </td>
                      <td
                        className={
                          "px-3 py-1.5 text-right tabular-nums " +
                          (isNegative ? "text-destructive line-through" : "font-medium")
                        }
                      >
                        {n != null ? formatKr(n) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button
            onClick={handleApply}
            disabled={saving || validChanges.length === 0}
            className="bg-app hover:bg-app-dark text-app-foreground"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Anvend ({validChanges.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
