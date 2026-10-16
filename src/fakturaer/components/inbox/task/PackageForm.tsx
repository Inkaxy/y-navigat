import { useEffect, useState } from "react";
import { InvoiceUnitCorrectionDialog } from "@/fakturaer/components/package/InvoiceUnitCorrectionDialog";
import { Loader2 } from "lucide-react";
import { PackageSpecFields } from "@/fakturaer/components/package/PackageSpecFields";
import { initialContainer } from "@/fakturaer/lib/packageSpec";
import { Button } from "@/components/ui/button";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { LineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { measuredBasis } from "@/fakturaer/lib/measuredUnit";
import { fmtNum, normalizeUnit, parsePackageFromDescription } from "@/fakturaer/lib/units";

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
  // «Kjøpes som» er visning/kontroll her: fakturaens enhet endres bare via «Rett fakturalinje».
  const [container, setContainer] = useState(() => initialContainer(line.unit));
  const [unitFix, setUnitFix] = useState(false);
  // Fersk linje med ny enhet (etter «Rett fakturert enhet»): beholderen følger linjen, innholdsutkastet beholdes.
  useEffect(() => { setContainer(initialContainer(line.unit)); }, [line.unit]);

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

  const measured = measuredBasis(line.unit, line.quantity, base);
  if (measured.kind !== "package") {
    const warn = measured.kind !== "direct";
    return (
      <div className="space-y-2" data-testid="measured-basis">
        <p className={warn ? "rounded-md bg-warning/10 px-3 py-2 text-caption text-warning" : "rounded-md bg-muted/60 px-3 py-2 text-sm"} aria-live="polite">{measured.text}</p>
        {measured.kind === "needs_kg" && (
          <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setUnitFix(true)}>Rett fakturert enhet</Button>
        )}
        {unitFix && <InvoiceUnitCorrectionDialog open onOpenChange={setUnitFix} lineId={line.id} />}
      </div>
    );
  }

  const isPieces = base === "stk";
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
      <PackageSpecFields
        idPrefix={`pkg-${line.id}`}
        baseUnit={base}
        invoiceUnit={line.unit}
        value={{ container, size: form.packageSize, contentUnit: form.packageUnit || base }}
        onChange={(v) => { setContainer(v.container); if (v.size !== form.packageSize) form.setPackageSize(v.size); if (v.contentUnit !== (form.packageUnit || base)) form.setPackageUnit(v.contentUnit); }}
        containerEditable={false}
        onCorrectUnit={() => setUnitFix(true)}
      />
      {unitFix && <InvoiceUnitCorrectionDialog open onOpenChange={setUnitFix} lineId={line.id} />}
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
