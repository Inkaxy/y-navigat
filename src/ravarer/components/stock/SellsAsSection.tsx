import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import {
  useDeleteProductLink,
  useLinkProduct,
  useProductSearch,
  useRawMaterialProducts,
  useUpdateProductLink,
} from "@/ravarer/hooks/useStock";

/** «Selges som» — kobling mellom innkjøpt handelsvare og varene som selges. */
export function SellsAsSection({ rm }: { rm: RawMaterialRow }) {
  const { canWrite } = useRavarer();
  const { data: links = [] } = useRawMaterialProducts(rm.id);
  const link = useLinkProduct();
  const updateLink = useUpdateProductLink();
  const removeLink = useDeleteProductLink();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { data: results = [] } = useProductSearch(term);

  const linkedIds = new Set(links.map(l => l.product_id));

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Selges som</h3>
          <p className="text-xs text-ink-secondary">Varene som trekker fra lageret av denne handelsvaren.</p>
        </div>
        {canWrite && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline"><Plus className="mr-1.5 h-4 w-4" /> Koble vare</Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="end">
              <Command shouldFilter={false}>
                <CommandInput placeholder="Søk navn eller varenummer…" value={term} onValueChange={setTerm} />
                <CommandList>
                  <CommandEmpty>{term.trim().length < 2 ? "Skriv minst to tegn." : "Ingen treff."}</CommandEmpty>
                  <CommandGroup>
                    {results.filter(p => !linkedIds.has(p.id)).map(p => (
                      <CommandItem
                        key={p.id}
                        value={p.id}
                        onSelect={async () => {
                          await link.mutateAsync({ raw_material_id: rm.id, product_id: p.id });
                          setOpen(false);
                          setTerm("");
                        }}
                      >
                        <span className="font-mono text-xs mr-2 text-ink-secondary">{p.code}</span>
                        {p.display_name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {rm.stock_tracking && links.length === 0 && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Lagerføring er på, men ingen vare er koblet — lageret fylles opp uten at noe trekkes fra.</span>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-ink-secondary">Ingen koblinger ennå.</p>
      ) : (
        <div className="space-y-3">
          {links.map(l => (
            <div key={l.id} className="flex flex-wrap items-end gap-4 rounded-md border border-line-subtle p-3">
              <div className="min-w-[200px] flex-1">
                <p className="font-medium">{l.product?.display_name ?? "Ukjent vare"}</p>
                <p className="font-mono text-xs text-ink-secondary">{l.product?.code}</p>
              </div>
              <div className="w-[200px]">
                <Label className="text-xs">Enhet</Label>
                <Select
                  value={
                    units.find(u => Number(u.units_in_base) === Number(l.base_units_per_sold_unit))?.id ??
                    (Number(l.base_units_per_sold_unit) === 1 ? BASE : CUSTOM)
                  }
                  onValueChange={v => {
                    if (v === CUSTOM) return;
                    const factor = v === BASE ? 1 : Number(units.find(u => u.id === v)?.units_in_base ?? 1);
                    if (factor !== Number(l.base_units_per_sold_unit)) {
                      updateLink.mutate({ id: l.id, raw_material_id: rm.id, base_units_per_sold_unit: factor });
                    }
                  }}
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BASE}>{rm.base_unit} (1)</SelectItem>
                    {units.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.unit_label} ({u.units_in_base} {rm.base_unit})
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Egendefinert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[220px]">
                <Label className="text-xs">Enheter trukket per solgt vare</Label>
                <Input
                  key={l.base_units_per_sold_unit}
                  type="number"
                  step="0.001"
                  defaultValue={l.base_units_per_sold_unit}
                  disabled={!canWrite}
                  onBlur={e => {
                    const v = Number(e.target.value.replace(",", "."));
                    if (Number.isFinite(v) && v !== l.base_units_per_sold_unit) {
                      updateLink.mutate({ id: l.id, raw_material_id: rm.id, base_units_per_sold_unit: v });
                    }
                  }}
                />
              </div>
              {canWrite && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLink.mutate({ id: l.id, raw_material_id: rm.id })}
                  title="Fjern kobling"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-secondary">
        Hvor mange enheter av innkjøpsvaren én solgt vare trekker. Selger du flasken du kjøpte: 1. Selger du glass av en
        10-liters bag: 0,25.
      </p>
    </Card>
  );
}
