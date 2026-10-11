import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber, PACKAGE_UNITS } from "@/ravarer/lib/constants";

// Én kilde til emballasjetypene: den kanoniske lista motoren selv kjenner.
const PACKAGE_UNIT_OPTIONS: readonly string[] = PACKAGE_UNITS;

export interface PackageFieldsProps {
  baseUnit: string;
  units: string;
  onUnitsChange: (v: string) => void;
  packageUnit: string;
  onPackageUnitChange: (v: string) => void;
  fillNote?: { text: string; ok: boolean } | null;
  /** Automatisk utledede forslag (fra navn/referansepris). */
  row?: { foreslatt_fra_navn?: number | null; foreslatt_fra_referanse?: number | null } | null;
  autoFocus?: boolean;
  /** Låst pakningsenhet (f.eks. fakturalinjens enhet) — vises som tekst i stedet for velger. */
  lockedUnit?: string | null;
  /** Feltets id (for etikett og tester). */
  inputId?: string;
  /** Egen etikett på mengdefeltet. */
  unitsLabel?: string;
  /** Tekstfelt med desimaltastatur (godtar «0,5»). Leses med felles desimalparser. */
  decimalText?: boolean;
  invalid?: boolean;
}

/** Felles visuelle pakningsfelt: mengde per pakning + pakningsenhet. */
export function PackageFields({
  baseUnit, units, onUnitsChange: setUnits, packageUnit, onPackageUnitChange: setPackageUnit, fillNote, row, autoFocus = false, lockedUnit, inputId, unitsLabel, invalid, decimalText = false,
}: PackageFieldsProps) {
  const locked = lockedUnit != null;
  const isBulk = !locked && packageUnit === "bulk";
  return (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={inputId}>{unitsLabel ?? `Antall ${baseUnit} per ${locked ? lockedUnit || "pakning" : "pakning"}`} {isBulk || locked ? "" : "*"}</Label>
                <Input
                  id={inputId}
                  {...(locked || decimalText ? { inputMode: "decimal" as const } : { type: "number", step: "0.001", min: "0" })}
                  aria-invalid={invalid}
                  value={isBulk ? "" : units}
                  onChange={e => setUnits(e.target.value)}
                  disabled={isBulk}
                  placeholder={isBulk ? `Bulk — faktureres per ${baseUnit}` : undefined}
                  autoFocus={autoFocus}
                />
                {fillNote && !isBulk && (
                  <p
                    className={
                      fillNote.ok
                        ? "mt-1 text-xs text-ink-secondary"
                        : "mt-1 text-xs text-warning"
                    }
                  >
                    {fillNote.text}
                  </p>
                )}
                {isBulk && (
                  <p className="mt-1 text-xs text-ink-secondary">
                    Bulk har ingen fast mengde per levering. Prisen regnes direkte per {baseUnit} fra fakturaen.
                  </p>
                )}
                {!isBulk && row && (row.foreslatt_fra_navn != null || row.foreslatt_fra_referanse != null) && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
                      <span>Forslag:</span>
                      {row.foreslatt_fra_navn != null && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setUnits(String(row.foreslatt_fra_navn))}
                          >
                            {formatNumber(row.foreslatt_fra_navn, 3)}
                          </Button>
                          <span>fra navnet</span>
                        </>
                      )}
                      {row.foreslatt_fra_navn != null && row.foreslatt_fra_referanse != null && <span>·</span>}
                      {row.foreslatt_fra_referanse != null && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setUnits(String(row.foreslatt_fra_referanse))}
                          >
                            {formatNumber(row.foreslatt_fra_referanse, 1)}
                          </Button>
                          <span>fra referanseprisen</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      Forslagene er utledet automatisk og må bekreftes.
                    </p>
                  </>
                )}
              </div>
              <div>
                <Label>Pakningsenhet</Label>
                {locked ? (
                  <p className="flex h-10 items-center text-sm text-ink-secondary">{lockedUnit || "fakturert enhet"} (fra fakturalinjen)</p>
                ) : (
                <Select value={packageUnit} onValueChange={setPackageUnit}>
                  <SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger>
                  <SelectContent>
                    {PACKAGE_UNIT_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
                )}
              </div>
            </div>

  );
}
