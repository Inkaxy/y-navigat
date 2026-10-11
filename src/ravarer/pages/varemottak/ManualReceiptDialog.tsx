import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useRawMaterialSearchIndex } from "@/ravarer/hooks/useRawMaterialSearchIndex";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { useReceiptMovement } from "@/ravarer/hooks/useGoodsReceipt";
import { UnitAmountRows, emptyRow, rowsToBase, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatNumber } from "@/ravarer/lib/constants";
import { osloTodayISO } from "@/lib/osloDate";

const today = () => osloTodayISO();

export function ManualReceiptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: materials = [] } = useRawMaterials();
  const move = useReceiptMovement();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rmId, setRmId] = useState<string | null>(null);
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  const [search, setSearch] = useState("");
  const index = useRawMaterialSearchIndex();
  // Søket dekker leverandørens varenummer og bekreftede aliaser, ikke bare navn
  // — «slice(0, 400)» gjorde at varer bakerst i lista aldri kunne velges.
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return materials.slice(0, 50);
    return materials
      .filter(m => {
        if (`${m.name} ${m.sku ?? ""}`.toLowerCase().includes(needle)) return true;
        const links = index.data?.linksByRawMaterial.get(m.id) ?? [];
        return links.some(
          l =>
            (l.supplierSku ?? "").toLowerCase().includes(needle) ||
            (l.supplierProductName ?? "").toLowerCase().includes(needle) ||
            l.aliases.some(a => a.toLowerCase().includes(needle)),
        );
      })
      .slice(0, 50);
  }, [materials, search, index.data]);

  const rm = materials.find(m => m.id === rmId) ?? null;
  const { data: units = [] } = useRawMaterialUnits(rmId ?? undefined);
  const base = rowsToBase(rows, units);

  const submit = async () => {
    if (!rmId || base == null || base <= 0) return;
    await move.mutateAsync({
      raw_material_id: rmId,
      quantity_base: base,
      kind: "purchase",
      note: "Manuelt mottak" + (note.trim() ? ` — ${note.trim()}` : ""),
      occurred_at: new Date(`${date}T12:00:00`).toISOString(),
    });
    setRmId(null);
    setRows([emptyRow()]);
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle><Truck className="mr-2 inline h-4 w-4" />Manuelt mottak</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Vare</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal">
                  {rm ? rm.name : "Velg vare…"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Søk navn, varenummer eller alias…" value={search} onValueChange={setSearch} />
                  <CommandList>
                    <CommandEmpty>Ingen treff.</CommandEmpty>
                    <CommandGroup>
                      {matches.map(m => (
                        <CommandItem
                          key={m.id}
                          value={`${m.name} ${m.sku ?? ""}`}
                          onSelect={() => {
                            setRmId(m.id);
                            setPickerOpen(false);
                          }}
                        >
                          {m.name}
                          <span className="ml-2 text-xs text-ink-secondary">{m.base_unit}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label className="text-xs">Mengde</Label>
            <UnitAmountRows rows={rows} onChange={setRows} units={units} baseUnit={rm?.base_unit ?? ""} />
            {base != null && rm && (
              <p className="mt-1 text-xs text-ink-secondary">
                Bokføres som +{formatNumber(base, 2)} {rm.base_unit}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Dato</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notat</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Valgfritt" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={move.isPending || !rmId || base == null || base <= 0}>Registrer mottak</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
