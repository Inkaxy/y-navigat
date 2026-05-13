import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";
import { formatNOK } from "@/ordre/lib/format";

export type FlatLineRow = {
  key: string;
  delivery_date: string;
  delivery_tour_id: string | null;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total_incl_vat: number;
  isDraft?: boolean;
};

export function FlatLinesView({
  rows,
  products,
  tours,
}: {
  rows: FlatLineRow[];
  products: MatrixProduct[];
  tours: MatrixTour[];
}) {
  const productById = new Map(products.map((p) => [p.id, p]));
  const tourById = new Map(tours.map((t) => [t.id, t]));
  const sorted = [...rows].sort((a, b) => {
    if (a.delivery_date !== b.delivery_date) return a.delivery_date < b.delivery_date ? -1 : 1;
    const ta = tourById.get(a.delivery_tour_id ?? "")?.tour_number ?? 0;
    const tb = tourById.get(b.delivery_tour_id ?? "")?.tour_number ?? 0;
    if (ta !== tb) return ta - tb;
    const pa = productById.get(a.product_id)?.display_number ?? 0;
    const pb = productById.get(b.product_id)?.display_number ?? 0;
    return pa - pb;
  });

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-card border-b">
          <tr className="text-left">
            <th className="px-3 py-2">Dato</th>
            <th className="px-3 py-2">Tur</th>
            <th className="px-3 py-2">Vare</th>
            <th className="px-3 py-2 text-right">Mengde</th>
            <th className="px-3 py-2 text-right">Pris</th>
            <th className="px-3 py-2 text-right">Sum inkl. mva</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Ingen ordrelinjer i synlig periode.</td></tr>
          )}
          {sorted.map((c) => {
            const p = productById.get(c.product_id);
            const t = tourById.get(c.delivery_tour_id ?? "");
            return (
              <tr key={c.key} className="border-b hover:bg-muted/30">
                <td className="px-3 py-1.5 tabular-nums">{c.delivery_date}</td>
                <td className="px-3 py-1.5">{t ? `T${t.tour_number} ${t.display_name}` : "—"}</td>
                <td className="px-3 py-1.5">
                  <span className="text-muted-foreground tabular-nums mr-2">{p?.display_number}</span>
                  {p?.display_name ?? c.product_id}
                  {c.isDraft && (
                    <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Ulagret
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.quantity}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatNOK(c.unit_price)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatNOK(c.line_total_incl_vat)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
