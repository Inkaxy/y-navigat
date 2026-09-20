import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatMoney } from "@/fakturaer/lib/constants";
import { blockerLabel, type StartPriceEligibility } from "@/fakturaer/lib/startPrice";
import { QueryState } from "@/components/common/QueryState";

/**
 * Ren presentasjon av startpris-bekreftelsen — ingen datahenting, ingen
 * mutasjoner. Gjør at dev-forhåndsvisningen kan vise nøyaktig samme flate
 * som den innloggede appen.
 */
export interface StartPricePanelProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  eligibility: StartPriceEligibility | null;
  description: string | null;
  rawMaterialName: string | null;
  supplierName: string | null;
  canWrite: boolean;
  isSaving: boolean;
  /** Satt når serveren avviste bekreftelsen — vises uten falsk suksess. */
  failure: string | null;
  confirmed: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-caption text-ink-secondary">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function StartPricePanel({
  isLoading,
  isError,
  error,
  onRetry,
  eligibility,
  description,
  rawMaterialName,
  supplierName,
  canWrite,
  isSaving,
  failure,
  confirmed,
  onConfirm,
  onClose,
}: StartPricePanelProps) {
  return (
    <div className="space-y-4">
      <QueryState
        scope="Startpris"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        isEmpty={!isLoading && !isError && !eligibility}
        emptyText="Fant ikke grunnlaget for denne linjen."
      >
        {eligibility && (
          <div className="space-y-4">
            <div className="rounded-md border border-line-subtle p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">Bekreftet kobling</Badge>
                <span className="text-sm font-medium">{rawMaterialName ?? "Ukjent vare"}</span>
                <span className="text-caption text-ink-secondary">{supplierName ?? "ukjent leverandør"}</span>
              </div>
              <p className="text-caption text-ink-secondary">{description ?? "Uten beskrivelse"}</p>

              <div className="mt-3 divide-y divide-line-subtle">
                <Row
                  label="Nettobeløp på linjen"
                  value={formatMoney(eligibility.total_amount, eligibility.currency)}
                />
                <Row
                  label="Mengde i grunnenhet"
                  value={
                    eligibility.base_quantity == null
                      ? "ikke avklart"
                      : `${eligibility.base_quantity} ${eligibility.base_unit ?? ""}`.trim()
                  }
                />
                <Row
                  label="Pakning"
                  value={
                    eligibility.package_size == null
                      ? "ikke bekreftet"
                      : `${eligibility.package_size} ${eligibility.package_unit ?? ""}`.trim()
                  }
                />
                <Row
                  label="Blir lagret som startpris"
                  value={
                    <span className="text-base">
                      {formatMoney(eligibility.price_per_base_unit, eligibility.currency)}
                      {eligibility.base_unit ? ` / ${eligibility.base_unit}` : ""}
                    </span>
                  }
                />
                <Row label="Gjelder fra" value={eligibility.invoice_date ?? "ukjent dato"} />
                <Row
                  label="Kilde"
                  value={`Faktura ${eligibility.invoice_number ?? "uten nummer"}`}
                />
              </div>

              <p className="mt-3 text-caption text-ink-secondary">
                Startprisen er fast. Senere kjøp flytter den ikke, og den blir aldri automatisk til avtalepris.
                En gyldig avtalepris går alltid foran startprisen.
              </p>
            </div>

            {eligibility.existing_start_price != null && (
              <div className="flex gap-2 rounded-md border border-line-subtle bg-muted/30 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>
                  Det finnes allerede en startpris på{" "}
                  {formatMoney(eligibility.existing_start_price, eligibility.currency)}
                  {eligibility.base_unit ? ` / ${eligibility.base_unit}` : ""}. Den første bekreftelsen vinner.
                </span>
              </div>
            )}

            {!eligibility.eligible && (
              <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Startpris kan ikke bekreftes ennå
                </div>
                <ul className="list-inside list-disc text-caption">
                  {eligibility.blockers.map((b) => (
                    <li key={b}>{blockerLabel(b)}</li>
                  ))}
                </ul>
              </div>
            )}

            {failure && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{failure}</div>
            )}
            {confirmed && (
              <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
                Startprisen er bekreftet og lagret.
              </div>
            )}
          </div>
        )}
      </QueryState>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Lukk
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!canWrite || isSaving || confirmed || !eligibility?.eligible}
        >
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Bekreft startpris
        </Button>
      </div>
    </div>
  );
}
