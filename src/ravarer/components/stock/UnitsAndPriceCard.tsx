import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Wand2 } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import {
  useDeleteRawMaterialUnit,
  useRawMaterialUnits,
  useUpsertRawMaterialUnit,
  type RawMaterialUnitRow,
} from "@/ravarer/hooks/useRawMaterialUnits";
import { useRawMaterialSuppliers } from "@/ravarer/hooks/useRmSuppliers";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";

interface Suggestion {
  label: string;
  unitsInBase: number;
}

/** Bekreftede pakninger på leverandørkoblinger + pakningen på varen selv. */
function useUnitSuggestions(rm: RawMaterialRow, existing: RawMaterialUnitRow[]): Suggestion[] {
  // Gjenbruk leverandørkoblingene som allerede er hentet for råvaren.
  const { data: links = [] } = useRawMaterialSuppliers(rm.id);

  return useMemo(() => {
    const out: Suggestion[] = [];
    const push = (label: string | null, size: number | null) => {
      if (!label || !size || size <= 0) return;
      const key = label.trim().toLowerCase();
      if (!key || key === rm.base_unit.toLowerCase()) return;
      if (existing.some(u => u.unit_label.trim().toLowerCase() === key)) return;
      if (out.some(s => s.label.toLowerCase() === key && s.unitsInBase === size)) return;
      out.push({ label: label.trim(), unitsInBase: size });
    };
    push(rm.package_unit, rm.base_units_per_package ?? rm.package_size);
    for (const l of links) {
      if (!l.package_confirmed_at) continue;
      push(l.package_unit, l.base_units_per_package == null ? null : Number(l.base_units_per_package));
    }
    return out;
  }, [links, rm, existing]);
}

interface FormState {
  id?: string;
  unit_label: string;
  units_in_base: string;
  is_default_purchase: boolean;
  is_default_count: boolean;
  is_sales_unit: boolean;
}

const EMPTY: FormState = {
  unit_label: "",
  units_in_base: "",
  is_default_purchase: false,
  is_default_count: false,
  is_sales_unit: false,
};

/** «Enheter og pris» — enhetshierarki med avledet pris per enhet. */
export function UnitsAndPriceCard({ rm }: { rm: RawMaterialRow }) {
  const { canWrite } = useRavarer();
  const { data: units = [] } = useRawMaterialUnits(rm.id);
  const upsert = useUpsertRawMaterialUnit();
  const remove = useDeleteRawMaterialUnit();
  const suggestions = useUnitSuggestions(rm, units);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const cost = rm.current_cost_price == null ? null : Number(rm.current_cost_price);
  const priceFor = (unitsInBase: number) => (cost == null ? null : cost * unitsInBase);

  const startNew = (preset?: Suggestion) => {
    setForm(preset ? { ...EMPTY, unit_label: preset.label, units_in_base: String(preset.unitsInBase) } : EMPTY);
    setOpen(true);
  };

  const startEdit = (u: RawMaterialUnitRow) => {
    setForm({
      id: u.id,
      unit_label: u.unit_label,
      units_in_base: String(u.units_in_base),
      is_default_purchase: u.is_default_purchase,
      is_default_count: u.is_default_count,
      is_sales_unit: u.is_sales_unit,
    });
    setOpen(true);
  };

  const size = Number(form.units_in_base.replace(",", "."));
  const canSave = form.unit_label.trim().length > 0 && Number.isFinite(size) && size > 0 && !upsert.isPending;

  const save = async () => {
    if (!canSave) return;
    await upsert.mutateAsync({
      id: form.id,
      raw_material_id: rm.id,
      unit_label: form.unit_label.trim(),
      units_in_base: size,
      is_default_purchase: form.is_default_purchase,
      is_default_count: form.is_default_count,
      is_sales_unit: form.is_sales_unit,
      sort_order: Math.round(size),
    });
    setOpen(false);
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Enheter og pris</h3>
          <p className="text-xs text-ink-secondary">
            {cost == null
              ? "Kostpris mangler — prisene per enhet kan ikke beregnes."
              : `Prisene beregnes fra kostpris ${formatNok(cost)}/${rm.base_unit}.`}
          </p>
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => startNew()}>
            <Plus className="mr-1.5 h-4 w-4" /> Ny enhet
          </Button>
        )}
      </div>

      {canWrite && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map(s => (
            <Button key={`${s.label}-${s.unitsInBase}`} size="sm" variant="ghost" onClick={() => startNew(s)}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              Opprett «{s.label}» = {formatNumber(s.unitsInBase, 3)} {rm.base_unit}
            </Button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
            <tr>
              <th className="py-2">Enhet</th>
              <th className="py-2 text-right">Innhold</th>
              <th className="py-2 text-right">Pris per enhet</th>
              <th className="py-2">Merker</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-subtle">
              <td className="py-2 font-medium">{rm.base_unit}</td>
              <td className="py-2 text-right tabular-nums text-ink-secondary">1 {rm.base_unit}</td>
              <td className="py-2 text-right tabular-nums">{formatNok(cost)}</td>
              <td className="py-2"><Badge variant="outline">Baseenhet</Badge></td>
              <td />
            </tr>
            {units.map(u => (
              <tr key={u.id} className="border-t border-line-subtle">
                <td className="py-2 font-medium">{u.unit_label}</td>
                <td className="py-2 text-right tabular-nums text-ink-secondary">
                  {formatNumber(u.units_in_base, 3)} {rm.base_unit}
                </td>
                <td className="py-2 text-right tabular-nums">{formatNok(priceFor(u.units_in_base))}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.is_default_purchase && <Badge variant="secondary">Innkjøp</Badge>}
                    {u.is_default_count && <Badge variant="secondary">Telling</Badge>}
                    {u.is_sales_unit && <Badge variant="secondary">Salg</Badge>}
                  </div>
                </td>
                <td className="py-2 text-right">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(u)} title="Rediger">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove.mutate({ id: u.id, raw_material_id: rm.id })}
                        title="Slett"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {units.length === 0 && (
        <p className="text-sm text-ink-secondary">
          Ingen ekstra enheter ennå. Legg til for eksempel «pose» eller «kartong» for å se hva én slik koster.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Rediger enhet" : "Ny enhet"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Enhetsnavn</Label>
              <Input
                value={form.unit_label}
                onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))}
                placeholder="pose, kartong, eske …"
                autoFocus
              />
            </div>
            <div>
              <Label>Innhold ({rm.base_unit} per enhet)</Label>
              <Input
                value={form.units_in_base}
                onChange={e => setForm(f => ({ ...f, units_in_base: e.target.value }))}
                inputMode="decimal"
                placeholder="36"
              />
              {Number.isFinite(size) && size > 0 && cost != null && (
                <p className="mt-1 text-xs text-ink-secondary">Pris per enhet: {formatNok(cost * size)}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_default_purchase}
                  onCheckedChange={v => setForm(f => ({ ...f, is_default_purchase: v === true }))}
                />
                Standard innkjøpsenhet
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_default_count}
                  onCheckedChange={v => setForm(f => ({ ...f, is_default_count: v === true }))}
                />
                Standard telleenhet
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_sales_unit}
                  onCheckedChange={v => setForm(f => ({ ...f, is_sales_unit: v === true }))}
                />
                Salgsenhet
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
            <Button onClick={save} disabled={!canSave}>Lagre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
