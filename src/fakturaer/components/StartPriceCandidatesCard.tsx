import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/components/common/QueryState";
import { formatMoney } from "@/fakturaer/lib/constants";
import {
  START_PRICE_QUERY_KEYS,
  confirmReasonLabel,
  confirmStartPrice,
  fetchStartPriceCandidates,
  type StartPriceCandidate,
} from "@/fakturaer/lib/startPrice";

/**
 * Forslag til startpriser fra eksisterende historikk.
 *
 * Ingen automatisk tilbakefylling: hver kandidat må hukes av og bekreftes, og
 * hver bekreftelse valideres på nytt av serveren. Utdaterte forslag avvises
 * der og rapporteres per rad.
 */
export function StartPriceCandidatesCard({
  legalEntityId,
  canWrite,
}: {
  legalEntityId: string | null;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rejected, setRejected] = useState<Array<{ id: string; text: string }>>([]);

  const query = useQuery({
    queryKey: START_PRICE_QUERY_KEYS.candidates(legalEntityId, null),
    enabled: !!legalEntityId,
    queryFn: () => fetchStartPriceCandidates(legalEntityId as string, null, 100),
  });
  const rows: StartPriceCandidate[] = query.data ?? [];
  const chosen = rows.filter((r) => selected[r.invoice_line_id]);

  const confirmAll = useMutation({
    mutationFn: async () => {
      const failures: Array<{ id: string; text: string }> = [];
      let created = 0;
      for (const row of chosen) {
        try {
          const res = await confirmStartPrice(row.invoice_line_id, row.price_per_base_unit);
          if (res.created) created += 1;
          else failures.push({ id: row.invoice_line_id, text: confirmReasonLabel(res.reason) });
        } catch (e) {
          failures.push({
            id: row.invoice_line_id,
            text: e instanceof Error ? e.message : "Ukjent feil ved bekreftelse",
          });
        }
      }
      return { created, failures };
    },
    onSuccess: ({ created, failures }) => {
      setRejected(failures);
      setSelected({});
      void qc.invalidateQueries({ queryKey: ["start-price-candidates"] });
      void qc.invalidateQueries({ queryKey: ["invoice-supplier-links"] });
      if (created > 0) toast.success(`${created} startpris${created === 1 ? "" : "er"} bekreftet`);
      if (failures.length > 0) toast.warning(`${failures.length} forslag ble avvist`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Kunne ikke bekrefte startprisene"),
  });

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Forslag til startpriser fra historikk</h2>
        <p className="text-caption text-ink-secondary">
          Kontrollerte kjøp som kan bli startpris. Ingenting lagres automatisk — du velger selv hvilke som skal
          bekreftes, og serveren kontrollerer hvert forslag på nytt.
        </p>
      </div>

      <QueryState
        scope="Startpris-forslag"
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="Ingen kjøp kvalifiserer til startpris nå."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
              <tr>
                <th className="w-9 py-2"></th>
                <th className="py-2">Vare</th>
                <th className="py-2">Leverandør</th>
                <th className="py-2">Kilde</th>
                <th className="py-2">Dato</th>
                <th className="py-2 text-right">Pris</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const failure = rejected.find((f) => f.id === r.invoice_line_id);
                return (
                  <tr key={r.invoice_line_id} className="border-t border-line-subtle align-top">
                    <td className="py-2">
                      <Checkbox
                        checked={!!selected[r.invoice_line_id]}
                        disabled={!canWrite}
                        onCheckedChange={(v) =>
                          setSelected((s) => ({ ...s, [r.invoice_line_id]: !!v }))
                        }
                        aria-label={`Velg ${r.raw_material_name ?? "vare"}`}
                      />
                    </td>
                    <td className="py-2">
                      <div className="font-medium">{r.raw_material_name ?? "Ukjent vare"}</div>
                      <div className="text-caption text-ink-secondary">{r.description ?? "uten beskrivelse"}</div>
                      {failure && <div className="text-caption text-destructive">{failure.text}</div>}
                    </td>
                    <td className="py-2">{r.supplier_name ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{r.invoice_number ?? "—"}</td>
                    <td className="py-2 tabular-nums">{r.invoice_date ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(r.price_per_base_unit, r.currency)}
                      {r.base_unit ? ` / ${r.base_unit}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!canWrite || chosen.length === 0 || confirmAll.isPending}
            onClick={() => confirmAll.mutate()}
          >
            {confirmAll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Bekreft {chosen.length} valgte
          </Button>
        </div>
      </QueryState>
    </Card>
  );
}
