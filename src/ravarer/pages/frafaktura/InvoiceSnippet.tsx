import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";
import { cn } from "@/lib/utils";

type Row = { id: string; line_number: number | null; supplier_sku: string | null; description: string | null; quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null };
const nb = (v: number | null, d = 2) => (v == null || !Number.isFinite(Number(v)) ? "–" : Number(v).toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d }));
const qty = (v: number | null) => (v == null ? "–" : Number(v).toLocaleString("nb-NO", { maximumFractionDigits: 3 }));

/** «Vis på fakturaen»: linjene rundt den aktuelle linjen slik de er lest, med linjen markert. */
export function InvoiceSnippet({ invoiceId, invoiceNumber, invoiceDate, supplierName, lineId, retur, onClose }: {
  invoiceId: string; invoiceNumber: string | null; invoiceDate: string | null; supplierName: string | null; lineId: string; retur: string; onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["ravarer", "fra-faktura", "snippet", invoiceId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.from("invoice_lines")
        .select("id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount")
        .eq("invoice_id", invoiceId).order("line_number", { ascending: true, nullsFirst: false }).order("id").limit(400);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const at = rows.findIndex((r) => r.id === lineId);
  const shown = at < 0 ? rows.slice(0, 3) : rows.slice(Math.max(0, at - 2), at + 3);
  return (
    <div className="overflow-hidden rounded-xl border border-line-subtle bg-background" role="region" aria-label={`Utsnitt av faktura ${invoiceNumber ?? ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-2 text-caption">
        <span><strong>{supplierName ?? "Leverandør"}</strong> · faktura {invoiceNumber ?? "uten nummer"} · {dateNo(invoiceDate)} · utsnitt av linjene slik de er lest, linjen er markert</span>
        <span className="ml-auto flex flex-wrap gap-3">
          {/* Feillest antall, pris, enhet eller tekst rettes via «Rett fakturalinje» (samme dialog, sperrer og revisjon som på fakturaen). */}
          <Link className="font-semibold text-primary hover:underline" to={paths.faktura(invoiceId, { linje: lineId, handling: "rett", retur })}>Rett linjen …</Link>
          <Link className="font-semibold text-primary hover:underline" to={paths.faktura(invoiceId, { linje: lineId, retur })}>Åpne hele fakturaen</Link>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={onClose}>Lukk</button>
        </span>
      </div>
      {q.isLoading ? <p className="px-4 py-3 text-caption text-ink-secondary">Henter linjene …</p>
        : q.isError ? <p role="alert" className="px-4 py-3 text-caption text-destructive">Kunne ikke hente fakturalinjene. Åpne hele fakturaen i stedet.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-caption">
              <thead className="text-left uppercase tracking-[0.08em] text-ink-secondary">
                <tr><th className="px-4 py-1.5 font-semibold">Varenr</th><th className="px-2 py-1.5 font-semibold">Tekst</th><th className="px-2 py-1.5 text-right font-semibold">Antall</th><th className="px-2 py-1.5 text-right font-semibold">Pris</th><th className="px-4 py-1.5 text-right font-semibold">Beløp</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={cn("border-t border-line-subtle", r.id === lineId && "bg-warning/15 font-semibold")} aria-current={r.id === lineId ? "true" : undefined}>
                    <td className="px-4 py-1.5 tabular-nums">{r.supplier_sku || "–"}</td>
                    <td className="px-2 py-1.5">{r.description ?? "–"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{qty(r.quantity)} {r.unit ?? ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{nb(r.unit_price)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{nb(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
