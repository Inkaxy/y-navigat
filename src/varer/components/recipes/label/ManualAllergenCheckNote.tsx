import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { allergenFindingText, type ManualAllergenCheck } from "@/varer/lib/manualAllergenCheck";

/**
 * Allergenkontroll for den manuelle ingredienslisten (art. 21). Feil sperrer
 * godkjenning av manuell kilde; advarsler skal sjekkes, men sperrer ikke.
 */
export function ManualAllergenCheckNote({ check, unreviewedCount }: { check: ManualAllergenCheck; unreviewedCount: number }) {
  return (
    <div id="merking-allergenkontroll" tabIndex={-1} className="scroll-mt-4 space-y-1.5 rounded-md border p-3 text-sm outline-none" aria-live="polite">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allergenkontroll</div>
      {check.state === "unknown" ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Kan ikke kontrolleres før merkedata er beregnet — allergenene fra råvarene er ikke kjent.
        </p>
      ) : check.findings.length === 0 ? (
        <p className="text-muted-foreground">Råvarene har ingen registrerte allergener å kontrollere mot.</p>
      ) : (
        <ul className="space-y-1">
          {check.errors.map((f) => (
            <li key={f.allergen} className="flex items-start gap-2 text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {allergenFindingText(f)}
            </li>
          ))}
          {check.warnings.map((f) => (
            <li key={f.allergen} className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {allergenFindingText(f)}
            </li>
          ))}
          {check.errors.length + check.warnings.length === 0 && (
            <li className="flex items-start gap-2 text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Alle allergener fra råvarene står fremhevet: {check.findings.map((f) => f.allergen).join(", ")}.
            </li>
          )}
        </ul>
      )}
      {unreviewedCount > 0 && (
        <p className="text-xs text-warning">
          {unreviewedCount} råvare{unreviewedCount === 1 ? "" : "r"} er ikke vurdert for allergener, så kontrollen kan være ufullstendig.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Allergenene skal stå i ingredienslisten og fremheves ved hver forekomst, med *stjerner* (fet skrift på etiketten) eller VERSALER.
        De skal ikke gjentas i en egen «Inneholder»-linje. Feil sperrer godkjenning av manuell deklarasjon.
      </p>
    </div>
  );
}

/** Kort veiledning ved feltet for spormerking. */
export function TraceLabelGuidance() {
  return (
    <p className="text-xs text-muted-foreground">
      Spormerking er frivillig og skal bygge på en risikovurdering av reell fare for krysskontaminering, for eksempel felles
      utstyr eller lokaler. Ikke bruk den som generell forsikring. Begrunnelsen kan ikke lagres her ennå.
    </p>
  );
}
