// Råvarer › Innstillinger › Fakturalesing: liste over leverandører og hvilken kilde fakturaene er lest fra.
// Bare lesing. Henter alle fakturaer i sider à 1000 (eksakt antall kontrolleres) før oppsummering.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryEmptyState, QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { SOURCE_LABEL, summarizeSupplierSources, type SourceInvoiceRow, type SupplierSource } from "@/ravarer/lib/fakturalesing/supplierSources";

const PAGE = 1000;

async function fetchRows(legalEntityId: string): Promise<SourceInvoiceRow[]> {
  const out: SourceInvoiceRow[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from("invoices")
      .select("id, supplier_id, lines_source, invoice_date, ehf_payload, suppliers(name)", { count: "exact" })
      .eq("legal_entity_id", legalEntityId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error("Kunne ikke hente fakturaene.");
    if (expected === null) expected = count ?? null;
    for (const r of data ?? []) {
      const sup = r.suppliers as { name?: string | null } | null;
      out.push({ supplier_id: r.supplier_id, supplier_name: sup?.name ?? null, lines_source: r.lines_source, invoice_date: r.invoice_date, ehf_payload: r.ehf_payload });
    }
    if (!data || data.length < PAGE) break;
  }
  if (expected !== null && out.length !== expected) throw new Error("Fakturalisten endret seg under hentingen. Prøv igjen.");
  return out;
}

const VARIANT: Record<SupplierSource["main"], "default" | "secondary" | "outline"> = {
  ehf: "default", pdf: "secondary", blandet: "outline", manuell: "outline", ikke_lest: "outline",
};

export function SupplierSourcesCard({ legalEntityId }: { legalEntityId: string }) {
  const q = useQuery({
    queryKey: ["ravarer", "fakturalesing", "leverandor-kilder", legalEntityId],
    queryFn: async () => summarizeSupplierSources(await fetchRows(legalEntityId)),
    staleTime: 60_000,
  });
  const nf = new Intl.NumberFormat("nb-NO");
  return (
    <Card id="innst-fakturalesing-kilder">
      <CardHeader>
        <CardTitle>Kilde per leverandør</CardTitle>
        <CardDescription>
          Hvor fakturalinjene er lest fra: EHF-filen eller PDF-en. Grunnen til at PDF ble brukt vises når importen har lagret den.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <QueryErrorState error={q.error} scope="fakturalesing-kilder" onRetry={() => void q.refetch()} title="Kunne ikke hente kildene" />
        ) : !q.data ? (
          <QueryLoadingState rows={4} />
        ) : q.data.length === 0 ? (
          <QueryEmptyState title="Ingen fakturaer ennå." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-caption text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Leverandør</th>
                  <th className="py-2 pr-3 font-medium">Kilde</th>
                  <th className="py-2 pr-3 text-right font-medium">EHF</th>
                  <th className="py-2 pr-3 text-right font-medium">PDF</th>
                  <th className="py-2 pr-3 text-right font-medium">Ikke lest</th>
                  <th className="py-2 font-medium">Siste grunn til PDF</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.supplierId ?? "uten"} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    <td className="py-2 pr-3"><Badge variant={VARIANT[s.main]}>{SOURCE_LABEL[s.main]}</Badge></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(s.ehf)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(s.pdf + s.manual)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nf.format(s.unread)}</td>
                    <td className="py-2 text-caption text-muted-foreground">{s.lastReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
