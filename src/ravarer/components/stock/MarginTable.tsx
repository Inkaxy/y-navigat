import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, Search, TrendingDown } from "lucide-react";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { useResaleMargins } from "@/ravarer/hooks/useResaleStock";

const kr = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);

/** «Fortjeneste» — dekningsbidrag per handelsvare, lavest dekningsgrad først. */
export function MarginTable() {
  const { data = [], isLoading } = useResaleMargins();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data
      .filter(r => !needle || `${r.name} ${r.sku} ${r.product_name ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (a.margin_pct == null && b.margin_pct == null) return a.name.localeCompare(b.name, "nb");
        if (a.margin_pct == null) return 1;
        if (b.margin_pct == null) return -1;
        return a.margin_pct - b.margin_pct;
      });
  }, [data, q]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk vare eller solgt vare…" className="pl-9" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-ink-secondary">Ingen handelsvarer å regne fortjeneste på ennå.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Vare</th>
                  <th className="px-4 py-3">Selges som</th>
                  <th className="px-4 py-3 text-right">Kostpris</th>
                  <th className="px-4 py-3 text-right">Salgspris</th>
                  <th className="px-4 py-3 text-right">DB kr</th>
                  <th className="px-4 py-3 text-right">DB %</th>
                  <th className="px-4 py-3 text-right">Solgt 30 d</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const low = r.margin_pct != null && r.margin_pct < 15;
                  return (
                    <tr key={r.raw_material_id} className={`border-t border-line-subtle ${low ? "bg-destructive/5" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-ink-secondary">{r.sku}</div>
                      </td>
                      <td className="px-4 py-3">
                        {r.product_name ?? <span className="text-ink-secondary">Ingen vare koblet</span>}
                        {r.base_units_per_sold_unit !== 1 && (
                          <div className="text-xs text-ink-secondary">
                            {formatNumber(r.base_units_per_sold_unit, 3)} {r.base_unit} per solgt enhet
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {kr(r.cost_per_sold_unit)}
                        {r.cost_is_stale && (
                          <div>
                            <Badge
                              variant="outline"
                              className="mt-1 border-warning/40 text-warning"
                              title={
                                r.price_updated_at
                                  ? `Kostprisen ble sist oppdatert ${formatDate(r.price_updated_at)}`
                                  : "Kostprisen har aldri blitt oppdatert"
                              }
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" /> Gammel kostpris
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{kr(r.sales_price)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{kr(r.margin_kr)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${low ? "text-destructive" : ""}`}>
                        {r.margin_pct == null ? "—" : `${formatNumber(r.margin_pct, 1)} %`}
                        {low && <TrendingDown className="ml-1 inline h-3.5 w-3.5" />}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                        {formatNumber(r.sold_30d, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
