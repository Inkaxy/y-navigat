import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAddPriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import { CostSourceInfo } from "@/ravarer/components/CostSourceInfo";
import { PRICE_SOURCES } from "@/ravarer/lib/constants";
import { osloTodayISO } from "@/lib/osloDate";
import { DEFAULT_COST_SOURCE, toPriceHistoryInput, validateCostPrice, type CostPriceDraft, type CostPriceErrors, type CostPriceSource } from "./costPriceLogic";

export interface CostPriceEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawMaterialId: string;
  rawMaterialName?: string;
  baseUnit: string;
  suppliers: { id: string; name: string }[];
  /** Forhåndsutfylt pris (f.eks. fra innebygd redigering i varelisten). */
  initialPrice?: number | null;
  initialSupplierId?: string | null;
  onSaved?: () => void;
}

const NONE = "_none";
const isSource = (v: string): v is CostPriceSource => PRICE_SOURCES.some((s) => s.value === v);

/** Eneste måte å sette kostpris manuelt. Skriver alltid prishistorikk. */
export function CostPriceEditor({
  open, onOpenChange, rawMaterialId, rawMaterialName, baseUnit, suppliers, initialPrice, initialSupplierId, onSaved,
}: CostPriceEditorProps) {
  const add = useAddPriceHistory();
  const fresh = (): CostPriceDraft => ({
    price: initialPrice != null ? String(initialPrice).replace(".", ",") : "",
    date: osloTodayISO(),
    supplierId: initialSupplierId ?? null,
    source: DEFAULT_COST_SOURCE,
    reason: "",
    setAsCurrent: true,
  });
  const [draft, setDraft] = useState<CostPriceDraft>(fresh);
  const [errors, setErrors] = useState<CostPriceErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setDraft(fresh()); setErrors({}); setSaveError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nullstill bare ved åpning
  }, [open]);

  const submit = async () => {
    const v = validateCostPrice(draft);
    if (!v.ok) { setErrors(v.errors); return; }
    setSaveError(null);
    try {
      await add.mutateAsync(toPriceHistoryInput(rawMaterialId, draft, v.price));
    } catch (e) {
      console.error("[kostpris:lagre]", e);
      setSaveError(e instanceof Error && e.message ? e.message : "Kostprisen ble ikke lagret. Prøv igjen.");
      return;
    }
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Endre kostpris</DialogTitle>
          <DialogDescription>{rawMaterialName ? `${rawMaterialName} · ` : ""}Lagres i prishistorikken med begrunnelse.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cpe-price">Pris (kr/{baseUnit}) *</Label>
              <Input id="cpe-price" inputMode="decimal" autoFocus value={draft.price} aria-invalid={!!errors.price}
                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
              {errors.price && <p className="mt-1 text-caption text-destructive">{errors.price}</p>}
            </div>
            <div>
              <Label htmlFor="cpe-date">Dato *</Label>
              <Input id="cpe-date" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
              {errors.date && <p className="mt-1 text-caption text-destructive">{errors.date}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Leverandør</Label>
              <Select value={draft.supplierId ?? NONE} onValueChange={(v) => setDraft((d) => ({ ...d, supplierId: v === NONE ? null : v }))}>
                <SelectTrigger aria-label="Leverandør"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Ingen / ukjent</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kilde</Label>
              <Select value={draft.source} onValueChange={(v) => { if (isSource(v)) setDraft((d) => ({ ...d, source: v })); }}>
                <SelectTrigger aria-label="Kilde"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRICE_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cpe-reason">Begrunnelse *</Label>
            <Textarea id="cpe-reason" rows={2} value={draft.reason} aria-invalid={!!errors.reason}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} placeholder="F.eks. ny prisliste fra leverandør" />
            {errors.reason && <p className="mt-1 text-caption text-destructive">{errors.reason}</p>}
          </div>
          <p className="text-caption text-ink-secondary">
            Nyeste gyldige pris etter dato blir gjeldende kostpris. En eldre dato endrer ikke en nyere pris, og en fremtidig dato blir gjeldende fra den dagen.
          </p>
          <CostSourceInfo rawMaterialId={rawMaterialId} />
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={add.isPending}>Lagre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
