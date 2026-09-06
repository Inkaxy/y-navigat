import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/common/QueryState";
import { formatNok, formatDate } from "@/ravarer/lib/constants";

interface Props {
  rawMaterialId: string;
  baseUnit: string;
}

interface Row {
  id: string;
  invoice_id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  invoices: {
    invoice_number: string | null;
    invoice_date: string | null;
    is_credit_note: boolean | null;
    supplier_id: string | null;
  } | null;
}

/** Viser de fem siste fakturalinjene som er koblet til råvaren. */
export function RecentInvoiceLinesCard({ rawMaterialId, baseUnit }: Props) {
  const query = useQuery({
    queryKey: ["rm-recent-invoice-lines", rawMaterialId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select(
          "id, invoice_id, description, quantity, unit, unit_price, line_total, invoices(invoice_number, invoice_date, is_credit_note, supplier_id)",
        )
        .eq("raw_material_id", rawMaterialId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = query.data ?? [];

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-base font-semibold">Siste fakturalinjer</h3>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        scope="Fakturalinjer"
        isEmpty={rows.length === 0}
        emptyTitle="Ingen fakturalinjer"
        emptyDescription="Råvaren er ikke koblet til noen fakturalinjer ennå."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-caption text-ink-secondary">
                <th className="pb-2">Dato</th>
                <th className="pb-2">Faktura</th>
                <th className="pb-2">Tekst</th>
                <th className="pb-2 text-right">Mengde</th>
                <th className="pb-2 text-right">Pris per {baseUnit}</th>
                <th className="pb-2 text-right">Beløp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 whitespace-nowrap">
                    {r.invoices?.invoice_date
                      ? formatDate(r.invoices.invoice_date)
                      : "—"}
                  </td>
                  <td className="py-2">
                    <Link to={`/faktura/${r.invoice_id}`} className="underline">
                      {r.invoices?.invoice_number ?? "Uten nummer"}
                    </Link>
                    {r.invoices?.is_credit_note && (
                      <span className="ml-1 text-xs text-warning">
                        Kreditnota
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-ink-secondary">
                    {r.description ?? "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.quantity == null ? "—" : `${r.quantity} ${r.unit ?? ""}`}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.unit_price == null
                      ? "—"
                      : formatNok(Number(r.unit_price))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.line_total == null
                      ? "—"
                      : formatNok(Number(r.line_total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </Card>
  );
}
