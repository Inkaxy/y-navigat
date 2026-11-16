import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";

type Row = { id: string; description: string | null; quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null; line_number: number | null };
const nb = (n: number | null, d = 2) => (n == null ? "–" : n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d }));

/** Utdrag fra fakturaen med aktuell linje markert (to linjer før og etter). Bare lesing. */
export function InvoiceExcerpt({ invoiceId, lineId, supplierName, invoiceNumber, invoiceDate, retur }: {
  invoiceId: string; lineId: string | null; supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null; retur: string;
}) {
  const q = useQuery({
    queryKey: ["ravarer", "decision-excerpt", invoiceId],
    staleTime: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.from("invoice_lines")
        .select("id, description, quantity, unit, unit_price, total_amount, line_number")
        .eq("invoice_id", invoiceId).is("excluded_at", null).order("line_number", { nullsFirst: false }).order("id").limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const at = Math.max(0, rows.findIndex((r) => r.id === lineId));
  const shown = rows.slice(Math.max(0, at - 2), at + 3);
  const href = `${paths.faktura(invoiceId)}?${new URLSearchParams({ ...(lineId ? { linje: lineId } : {}), retur }).toString()}`;
  return (
    <section aria-label="Fra fakturaen" className="overflow-hidden rounded-xl border border-line-subtle">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-muted/40 px-3 py-2 text-caption">
        <span className="font-semibold uppercase tracking-[0.12em] text-ink-secondary">Fra fakturaen</span>
        <span className="font-semibold">{[supplierName, invoiceNumber, dateNo(invoiceDate)].filter(Boolean).join(" · ")}</span>
        <Link to={href} className="ml-auto inline-flex min-h-[44px] items-center font-semibold text-primary underline-offset-2 hover:underline sm:min-h-0">Åpne hele fakturaen</Link>
      </div>
      {q.isLoading ? <p className="px-3 py-2 text-caption text-ink-secondary">Henter linjene …</p>
        : q.isError ? <p className="px-3 py-2 text-caption text-ink-secondary">Kunne ikke hente fakturalinjene.</p>
        : (
          <table className="w-full text-body">
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={cn("border-b border-line-subtle last:border-0", r.id === lineId && "bg-accent font-semibold")}>
                  <td className={cn("px-3 py-1.5", r.id === lineId && "border-l-4 border-l-primary")}>{r.description ?? "–"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{nb(r.quantity, 0)}{r.unit ? ` ${r.unit}` : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{nb(r.unit_price)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{nb(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
