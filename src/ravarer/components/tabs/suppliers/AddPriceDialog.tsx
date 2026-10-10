import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDecimal } from "@/ravarer/lib/packageMath";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAddPriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import { PRICE_SOURCES } from "@/ravarer/lib/constants";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { osloTodayISO } from "@/lib/osloDate";

interface AddPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rm: RawMaterialRow;
  suppliers: { id: string; name: string }[];
}

export function AddPriceDialog({ open, onOpenChange, rm, suppliers }: AddPriceDialogProps) {
  const add = useAddPriceHistory();
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(osloTodayISO());
  const [supplierId, setSupplierId] = useState<string>("_none");
  const [source, setSource] = useState("manual");
  const [notes, setNotes] = useState("");
  const [setCurrent, setSetCurrent] = useState(true);

  const submit = async () => {
    // «12,50» må godtas — Number() på komma gir NaN og tapte prisen stille.
    const priceNum = parseDecimal(price);
    if (priceNum == null) return;
    await add.mutateAsync({
      raw_material_id: rm.id,
      supplier_id: supplierId === "_none" ? null : supplierId,
      price: priceNum,
      effective_date: date,
      source,
      notes: notes || null,
      set_as_current: setCurrent,
    });
    onOpenChange(false);
    setPrice("");
    setNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrer ny pris</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Pris (kr/{rm.base_unit}) *</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>Dato *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Leverandør</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Ingen / ukjent</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kilde</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notat</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={setCurrent}
              onChange={(e) => setSetCurrent(e.target.checked)}
            />
            Sett som gjeldende pris på råvaren
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={!price || add.isPending}>
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
