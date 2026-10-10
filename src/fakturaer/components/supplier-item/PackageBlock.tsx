import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { PackageInference } from "@/fakturaer/lib/supplierItems";
import { SOURCE_LABEL } from "@/fakturaer/lib/linkFormLogic";
import { formatDate } from "@/fakturaer/lib/constants";

interface Props {
  idPrefix: string;
  baseUnit: string;
  packageUnit: string;
  value: string;
  onChange: (v: string) => void;
  confirm: boolean;
  onConfirm: (v: boolean) => void;
  inference: PackageInference | undefined;
  loading: boolean;
  existing: { bupp: number; confirmedAt: string } | null;
  editing: boolean;
  onEdit: () => void;
}

/** Blokk 2: «Hva inneholder én <enhet>?» */
export function PackageBlock(p: Props) {
  if (p.existing && !p.editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-3 text-sm">
        <span>
          {p.existing.bupp.toLocaleString("nb-NO")} {p.baseUnit} per {p.packageUnit}, bekreftet {formatDate(p.existing.confirmedAt)}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={p.onEdit}>Endre</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="w-32">
          <Label htmlFor={`${p.idPrefix}-bupp`} className="text-caption">Innhold</Label>
          <Input id={`${p.idPrefix}-bupp`} inputMode="decimal" value={p.value} onChange={(e) => p.onChange(e.target.value)} className="mt-1 tabular-nums" />
        </div>
        <span className="pb-2 text-sm text-ink-secondary">{p.baseUnit} per {p.packageUnit}</span>
        {p.loading && <Loader2 className="mb-2.5 h-4 w-4 animate-spin text-ink-secondary" aria-label="Regner ut pakning" />}
      </div>
      {p.inference?.explanation && <p className="text-caption text-ink-secondary">{p.inference.explanation}</p>}
      {p.inference?.source && (
        <span className="inline-flex rounded-md border border-line-subtle bg-muted px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">
          {SOURCE_LABEL[p.inference.source]}
        </span>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={p.confirm} onCheckedChange={(v) => p.onConfirm(v === true)} />
        Bekreft pakningen for denne leverandøren
      </label>
    </div>
  );
}
