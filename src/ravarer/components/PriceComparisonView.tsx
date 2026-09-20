import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { formatDate } from "@/ravarer/lib/constants";
import { formatMoney } from "@/fakturaer/lib/constants";
import type { PriceObservation, PriceSummary } from "@/ravarer/hooks/usePriceComparison";

const ALL = "__alle__";

/** Enheten på en observasjon er aldri lagret — den er en antakelse. */
function unitLabel(o: PriceObservation, baseUnit: string): string {
  return o.unit_changed_since ? "ukjent enhet" : baseUnit;
}

function labelsFor(o: PriceObservation): { text: string; tone: "outline" | "secondary" | "destructive" }[] {
  const out: { text: string; tone: "outline" | "secondary" | "destructive" }[] = [];
  out.push(
    o.source === "invoice"
      ? { text: "Observert på faktura", tone: "outline" }
      : { text: "Registrert manuelt", tone: "secondary" },
  );
  if (o.confirmed_link) out.push({ text: "Bekreftet kobling", tone: "secondary" });
  if (o.is_credit) out.push({ text: "Kreditnota", tone: "destructive" });
  if (o.is_legacy) out.push({ text: "Historisk", tone: "secondary" });
  if (o.superseded_at) out.push({ text: "Erstattet", tone: "destructive" });
  if (o.unit_changed_since) out.push({ text: "Enhet ikke bekreftet", tone: "destructive" });
  if ((o.currency ?? "NOK").toUpperCase() !== "NOK") {
    out.push({ text: `Valuta ${(o.currency ?? "").toUpperCase()}`, tone: "destructive" });
  }
  return out;
}

export interface PriceComparisonViewProps {
  baseUnit: string;
  onDate: string;
  summary: PriceSummary | null;
  observations: PriceObservation[];
  /** Navn per leverandør-id; brukes både i filteret og i tabellen. */
  supplierNames: Map<string, string>;
  supplierId: string | null;
  onSupplierChange: (id: string | null) => void;
  /** Feil på leverandørlisten skal vises, ikke svelges. */
  suppliersError?: unknown;
  onRetrySuppliers?: () => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** Hvor mange observasjoner som er hentet, og om det finnes flere. */
  loadedLimit: number;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore?: boolean;
}

/**
 * Presentasjonen av prissammenligningen — helt uten datahenting, slik at den
 * kan vises med faste data i en utviklingsforhåndsvisning.
 *
 * To ting skal ALDRI skje her: et beløp i en annen valuta skal ikke vises som
 * kroner, og en pris fra før grunnenheten ble endret skal ikke få dagens enhet
 * hengt på seg.
 */
export function PriceComparisonView({
  baseUnit,
  onDate,
  summary: s,
  observations: rows,
  supplierNames,
  supplierId,
  onSupplierChange,
  suppliersError,
  onRetrySuppliers,
  isLoading,
  isError,
  error,
  onRetry,
  loadedLimit,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: PriceComparisonViewProps) {
  const unitChangedAt = s?.unit_changed_at ?? null;
  const foreignCurrency = rows.filter((o) => (o.currency ?? "NOK").toUpperCase() !== "NOK");

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Prissammenligning</h3>
          <p className="text-caption text-ink-secondary">Per {baseUnit}, målt {formatDate(onDate)}.</p>
        </div>
        <Select value={supplierId ?? ALL} onValueChange={(v) => onSupplierChange(v === ALL ? null : v)}>
          <SelectTrigger className="h-9 w-full sm:w-[240px]" aria-label="Filtrer på leverandør">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle leverandører</SelectItem>
            {[...supplierNames].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {suppliersError != null && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          Leverandørlisten kunne ikke hentes, så filteret kan mangle leverandører.
          {onRetrySuppliers && (
            <Button variant="outline" size="sm" onClick={onRetrySuppliers}>
              Prøv igjen
            </Button>
          )}
        </p>
      )}

      <QueryState
        scope="prissammenligningen"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
      >
        <>
          {unitChangedAt && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
              Grunnenheten på varen ble endret {formatDate(unitChangedAt)}. Tallene under bygger <strong>bare</strong> på
              kjøp etter den datoen — eldre observasjoner er holdt utenfor fordi enheten deres er ukjent.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Figure
              title="Avtalepris"
              value={s?.agreement?.price ?? null}
              baseUnit={baseUnit}
              note={
                supplierId == null
                  ? "Velg leverandør for å se avtalen"
                  : s?.agreement
                    ? `Gyldig fra ${formatDate(s.agreement.valid_from)}${
                        s.agreement.valid_to ? ` til ${formatDate(s.agreement.valid_to)}` : ""
                      }`
                    : "Ingen gyldig avtale på datoen"
              }
            />
            <Figure
              title="Forrige kjøp"
              value={s?.last_purchase?.price ?? null}
              baseUnit={baseUnit}
              note={
                s?.last_purchase
                  ? `${formatDate(s.last_purchase.date)}${
                      s.last_purchase.supplier_id
                        ? ` · ${supplierNames.get(s.last_purchase.supplier_id) ?? "ukjent leverandør"}`
                        : ""
                    }`
                  : unitChangedAt
                    ? "Ingen sammenlignbare kjøp etter enhetsendringen"
                    : "Ingen kontrollerte kjøp"
              }
            />
            <Figure
              title="Snitt siste 90 dager"
              value={s?.weighted_90d ?? null}
              baseUnit={baseUnit}
              note={
                s && (s.weighted_90d_observations ?? 0) > 0
                  ? `${formatMoney(s.weighted_90d_amount, "NOK")} ÷ ${s.weighted_90d_quantity} ${baseUnit} · ${s.weighted_90d_observations} kjøp fra ${s.weighted_90d_suppliers} leverandør(er)`
                  : "Ingen kjøp med kjent mengde i perioden"
              }
            />
          </div>

          <p className="text-caption text-ink-secondary">
            Sammendraget regner bare med kjøp i norske kroner. Observasjoner i andre valutaer står i tabellen med sin
            egen valuta, men er ikke med i tallene over.
          </p>

          {rows.length === 0 ? (
            <p className="text-caption text-ink-secondary">Ingen prisobservasjoner for dette utvalget.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line-subtle text-left text-caption text-ink-secondary">
                    <th className="py-2 pr-3">Dato</th>
                    <th className="py-2 pr-3">Pris</th>
                    <th className="py-2 pr-3">Mengde</th>
                    <th className="py-2 pr-3">Leverandør</th>
                    <th className="py-2">Kilde</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-b border-line-subtle/60 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(o.effective_date)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatMoney(o.price, o.currency)}
                        <span className="text-caption text-ink-secondary"> / {unitLabel(o, baseUnit)}</span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {o.base_quantity == null
                          ? "ukjent"
                          : `${o.base_quantity} ${o.unit_changed_since ? "(ukjent enhet)" : baseUnit}`}
                      </td>
                      <td className="py-2 pr-3">
                        {o.supplier_id ? (supplierNames.get(o.supplier_id) ?? "Ukjent leverandør") : "—"}
                      </td>
                      <td className="py-2">
                        <span className="flex flex-wrap gap-1">
                          {labelsFor(o).map((l) => (
                            <Badge key={l.text} variant={l.tone}>
                              {l.text}
                            </Badge>
                          ))}
                          {o.invoice_id && (
                            <Link
                              to={`/ravarer/fakturaer/${o.invoice_id}`}
                              className="text-app underline-offset-2 hover:underline"
                            >
                              Åpne faktura
                            </Link>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption text-ink-secondary">
              Viser {rows.length} observasjoner
              {hasMore ? ` — de ${loadedLimit} nyeste. Det finnes flere.` : " — alle som finnes for utvalget."}
            </p>
            {hasMore && (
              <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
                Hent {loadedLimit} til
              </Button>
            )}
          </div>

          <p className="text-caption text-ink-secondary">
            Prishistorikken lagrer ingen enhet. Tallene vises i varens grunnenhet i dag ({baseUnit}), og det er en
            antakelse — ikke en bekreftet enhet på den enkelte observasjonen.
          </p>
          {rows.some((o) => o.unit_changed_since) && (
            <p className="text-caption text-warning">
              Noen observasjoner er eldre enn den siste endringen av grunnenheten. De er merket «Enhet ikke bekreftet»,
              vises uten enhet og er holdt utenfor tallene over.
            </p>
          )}
          {foreignCurrency.length > 0 && (
            <p className="text-caption text-warning">
              {foreignCurrency.length} observasjon(er) er i en annen valuta enn kroner og kan ikke sammenlignes direkte.
            </p>
          )}
        </>
      </QueryState>
    </Card>
  );
}

function Figure({
  title,
  value,
  baseUnit,
  note,
}: {
  title: string;
  value: number | null;
  baseUnit: string;
  note: string;
}) {
  return (
    <div className="rounded-md border border-line-subtle p-3">
      <p className="text-caption text-ink-secondary">{title}</p>
      <p className="text-title">
        {value == null ? "—" : formatMoney(value, "NOK")}
        {value != null && <span className="text-caption text-ink-secondary"> / {baseUnit}</span>}
      </p>
      <p className="text-caption text-ink-secondary">{note}</p>
    </div>
  );
}
