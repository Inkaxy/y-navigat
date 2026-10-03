import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { LineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { CANONICAL_BASE_UNITS, fmtNum, normalizeUnit, parsePackageFromDescription, toBaseFactor } from "@/fakturaer/lib/units";

/**
 * «Hvor mye inneholder én eske?» — svaret oppgis i råvarens grunnenhet (eller en
 * enhet som kan regnes om til den). Regnestykket viser bare det beregningen
 * faktisk bruker, og det er det samme tallet som lagres.
 */
export function PackageForm({ line, form }: { line: ReviewLineRow; form: LineMatchForm }) {
  const unit = line.unit ?? "fakturert enhet";
  const base = normalizeUnit(form.selectedRm?.base_unit) ?? form.selectedRm?.base_unit ?? null;
  const parsed = parsePackageFromDescription(line.description);
  const draft = form.packageDraft;
  const cost = form.cost;

  if (form.materialLoading) {
    return (
      <p className="flex items-center gap-2 text-caption text-ink-secondary" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Henter råvaren …
      </p>
    );
  }
  if (form.materialError) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive">
        Råvaren kunne ikke hentes.
        <Button size="sm" variant="outline" onClick={form.retryMaterial}>
          Prøv igjen
        </Button>
      </div>
    );
  }
  if (!base) return <p className="text-caption text-ink-secondary">Velg råvare for å fylle inn pakningen.</p>;

  const isPieces = base === "stk";
  const units = CANONICAL_BASE_UNITS.filter((u) => toBaseFactor(u, base) != null);
  const used = cost && !cost.needsInput ? cost.baseUnitsPerPackage : null;
  const draftUsed = draft.state === "valid" && used != null && Math.abs(used - draft.baseUnitsPerPackage) < 1e-9;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{isPieces ? `Hvor mange stk inneholder én ${unit}?` : `Hvor mye inneholder én ${unit}?`}</p>
      {form.linkExists?.package_confirmed_at && !form.packageNote && (
        <p className="text-caption text-ink-secondary">Bekreftet pakning hos leverandøren er fylt inn og huskes til senere fakturaer.</p>
      )}
      {form.packageNote && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">{form.packageNote}</p>
      )}
      {parsed && (
        <p className="text-caption text-ink-secondary">
          Varenavnet antyder {parsed.count && parsed.count > 1 ? `${parsed.count} × ` : ""}
          {fmtNum(parsed.size)} {parsed.unit}.
          {isPieces && parsed.unit !== "stk"
            ? ` ${fmtNum(parsed.size)} ${parsed.unit} er vekt eller volum per stk og bestemmer ikke antallet.`
            : " Det er et forslag til du bekrefter."}
        </p>
      )}
      <div className={isPieces ? "" : "grid grid-cols-[1fr_8rem] gap-2"}>
        <div>
          <Label htmlFor={`pkg-size-${line.id}`} className="text-caption">
            {isPieces ? `Antall stk per ${unit}` : `Innhold per ${unit}`}
          </Label>
          <Input
            id={`pkg-size-${line.id}`}
            inputMode="decimal"
            value={form.packageSize}
            onChange={(e) => form.setPackageSize(e.target.value)}
            aria-invalid={draft.state === "invalid"}
            className="mt-1"
          />
        </div>
        {!isPieces && (
          <div>
            <Label htmlFor={`pkg-unit-${line.id}`} className="text-caption">
              Enhet
            </Label>
            <Select value={form.packageUnit || base} onValueChange={form.setPackageUnit}>
              <SelectTrigger id={`pkg-unit-${line.id}`} className="mt-1">
                <SelectValue placeholder="Velg" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {draft.state === "invalid" ? (
        <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">
          {draft.reason}
        </p>
      ) : draft.state === "empty" ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">
          Fyll inn {isPieces ? "antall stk" : "innholdet"} i én {unit} for å regne om mengden.
        </p>
      ) : cost && !cost.needsInput ? (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
          {draftUsed ? (
            <>
              {fmtNum(Number(line.quantity ?? 0))} {unit} × {fmtNum(draft.baseUnitsPerPackage, 3)} {base} ={" "}
              <strong>
                {fmtNum(cost.baseQuantity, 3)} {base}
              </strong>
            </>
          ) : (
            <span className="text-caption text-warning">
              Fakturaen er ført i en enhet som regnes direkte om til {base}, så pakningsinnholdet bestemmer ikke mengden her.
            </span>
          )}
          <span className="block text-caption text-ink-secondary">{cost.explanation}</span>
        </div>
      ) : (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning" aria-live="polite">
          {cost?.reason ?? `Mengden kan ikke regnes om til ${base} ennå.`}
        </p>
      )}
    </div>
  );
}
