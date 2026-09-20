import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { usePriceComparison, type PriceObservation } from "@/ravarer/hooks/usePriceComparison";

const ALL = "__alle__";

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
  return out;
}

/**
 * Prissammenligning per leverandør: avtalepris, forrige kontrollerte kjøp og
 * mengdevektet 90-dagerssnitt (beløp ÷ mengde — aldri snitt av priser), med
 * observasjonene tallene bygger på.
 */
export function PriceComparisonCard({
  rawMaterialId,
  baseUnit,
}: {
  rawMaterialId: string;
  baseUnit: string;
}) {
  const [supplier, setSupplier] = useState<string>(ALL);
  const supplierId = supplier === ALL ? null : supplier;
  const { summary, observations, onDate } = usePriceComparison(rawMaterialId, supplierId);

  const suppliers = useQuery({
    queryKey: ["rm-comparison-suppliers", rawMaterialId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_suppliers")
        .select("supplier_id, supplier:suppliers(name)")
        .eq("raw_material_id", rawMaterialId);
      if (error) throw error;
      return (data ?? []) as unknown as { supplier_id: string; supplier: { name: string } | null }[];
    },
  });

  const supplierNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers.data ?? []) m.set(s.supplier_id, s.supplier?.name ?? "Ukjent leverandør");
    return m;
  }, [suppliers.data]);

  const rows = observations.data ?? [];
  const s = summary.data;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Prissammenligning</h3>
          <p className="text-caption text-ink-secondary">Per {baseUnit}, målt {formatDate(onDate)}.</p>
        </div>
        <Select value={supplier} onValueChange={setSupplier}>
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

      <QueryState
        scope="prissammenligningen"
        isLoading={summary.isLoading || observations.isLoading}
        isError={summary.isError || observations.isError}
        error={summary.error ?? observations.error}
        onRetry={() => {
          void summary.refetch();
          void observations.refetch();
        }}
      >
        <>
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
                  : "Ingen kontrollerte kjøp"
              }
            />
            <Figure
              title="Snitt siste 90 dager"
              value={s?.weighted_90d ?? null}
              baseUnit={baseUnit}
              note={
                s && (s.weighted_90d_observations ?? 0) > 0
                  ? `${formatNok(s.weighted_90d_amount)} ÷ ${s.weighted_90d_quantity} ${baseUnit} · ${s.weighted_90d_observations} kjøp fra ${s.weighted_90d_suppliers} leverandør(er)`
                  : "Ingen kjøp med kjent mengde i perioden"
              }
            />
          </div>

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
                        {formatNok(o.price)}
                        <span className="text-caption text-ink-secondary">
                          {" "}
                          / {o.unit_changed_since ? "ukjent enhet" : baseUnit}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {o.base_quantity == null
                          ? "ukjent"
                          : o.unit_changed_since
                            ? `${o.base_quantity} (ukjent enhet)`
                            : `${o.base_quantity} ${baseUnit}`}
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

          <p className="text-caption text-ink-secondary">
            Prishistorikken lagrer ingen enhet. Tallene vises i varens grunnenhet i dag ({baseUnit}), og det er en
            antakelse — ikke en bekreftet enhet på den enkelte observasjonen.
          </p>
          {rows.some((o) => o.unit_changed_since) && (
            <p className="text-caption text-warning">
              Grunnenheten på varen er endret etter noen av observasjonene. Disse er merket «Enhet ikke bekreftet» og
              kan ikke sammenlignes direkte med de nyere prisene.
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
        {value == null ? "—" : formatNok(value)}
        {value != null && <span className="text-caption text-ink-secondary"> / {baseUnit}</span>}
      </p>
      <p className="text-caption text-ink-secondary">{note}</p>
    </div>
  );
}
