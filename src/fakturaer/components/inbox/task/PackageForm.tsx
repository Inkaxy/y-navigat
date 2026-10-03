import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { LineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { CANONICAL_BASE_UNITS, CANONICAL_PACKAGE_UNITS, fmtNum, parsePackageFromDescription } from "@/fakturaer/lib/units";

/**
 * «Hvor mye inneholder én eske?» — dagens pakningsmodell (innhold + enhet per
 * fakturert enhet), med ett regnestykke til råvarens grunnenhet.
 */
export function PackageForm({ line, form }: { line: ReviewLineRow; form: LineMatchForm }) {
  const unit = line.unit ?? "fakturert enhet";
  const baseUnit = form.selectedRm?.base_unit ?? null;
  const parsed = parsePackageFromDescription(line.description);
  const cost = form.cost;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Hvor mye inneholder én {unit}?</p>
      {parsed && (
        <p className="text-caption text-ink-secondary">
          Varenavnet antyder {parsed.count && parsed.count > 1 ? `${parsed.count} × ` : ""}
          {fmtNum(parsed.size)} {parsed.unit}. Det er et forslag til du bekrefter.
        </p>
      )}
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <div>
          <Label htmlFor={`pkg-size-${line.id}`} className="text-caption">
            Innhold
          </Label>
          <Input
            id={`pkg-size-${line.id}`}
            inputMode="decimal"
            value={form.packageSize}
            onChange={(e) => form.setPackageSize(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`pkg-unit-${line.id}`} className="text-caption">
            Enhet
          </Label>
          <Select value={form.packageUnit} onValueChange={form.setPackageUnit}>
            <SelectTrigger id={`pkg-unit-${line.id}`} className="mt-1">
              <SelectValue placeholder="Velg" />
            </SelectTrigger>
            <SelectContent>
              {[...CANONICAL_BASE_UNITS, ...CANONICAL_PACKAGE_UNITS].map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!baseUnit ? (
        <p className="text-caption text-ink-secondary">Regnestykket vises når råvaren er valgt.</p>
      ) : cost && !cost.needsInput ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
          {fmtNum(Number(line.quantity ?? 0))} {unit}
          {form.packageSize ? ` × ${form.packageSize} ${form.packageUnit || baseUnit}` : ""} ={" "}
          <strong>
            {fmtNum(cost.baseQuantity, 3)} {baseUnit}
          </strong>
          <span className="block text-caption text-ink-secondary">{cost.explanation}</span>
        </p>
      ) : (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning" aria-live="polite">
          {cost?.reason ?? `Mengden kan ikke regnes om til ${baseUnit} ennå.`}
        </p>
      )}
    </div>
  );
}
