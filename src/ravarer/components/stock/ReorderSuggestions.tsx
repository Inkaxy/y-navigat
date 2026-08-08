import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, PackagePlus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/ravarer/lib/constants";
import { reorderGroupToText, useReorderSuggestions } from "@/ravarer/hooks/useResaleStock";

const kr = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n);

/** «Bør bestilles» — forslag gruppert per primærleverandør. */
export function ReorderSuggestions() {
  const { data: groups = [], isLoading } = useReorderSuggestions();
  const [open, setOpen] = useState<string | null>(null);

  const totals = useMemo(
    () => ({
      items: groups.reduce((s, g) => s + g.lines.length, 0),
      value: groups.reduce((s, g) => s + g.total_value, 0),
    }),
    [groups],
  );

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Kopiert til utklippstavlen");
  };

  if (isLoading || groups.length === 0) return null;

  return (
    <Card className="overflow-hidden border-warning/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle bg-warning/10 p-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-warning" />
          <div>
            <p className="font-medium">Bør bestilles</p>
            <p className="text-sm text-ink-secondary">
              {totals.items} varer under minimum eller med under 10 dager igjen · {kr(totals.value)} i innkjøpsverdi
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-line-subtle">
        {groups.map(g => {
          const key = g.supplier_id ?? g.supplier_name;
          const isOpen = open === key;
          return (
            <div key={key}>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  className="flex-1 text-left"
                  onClick={() => setOpen(isOpen ? null : key)}
                >
                  <p className="font-medium">{g.supplier_name}</p>
                  <p className="text-sm text-ink-secondary">
                    {g.lines.length} varer · {kr(g.total_value)}
                  </p>
                </button>
                <Button size="sm" variant="outline" onClick={() => copy(reorderGroupToText(g))}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Kopier liste
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : key)}>
                  {isOpen ? "Skjul" : "Vis varer"}
                </Button>
              </div>

              {isOpen && (
                <div className="overflow-x-auto border-t border-line-subtle bg-muted/20">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
                      <tr>
                        <th className="px-4 py-2">Vare</th>
                        <th className="px-4 py-2 text-right">Disponibelt</th>
                        <th className="px-4 py-2 text-right">Min.</th>
                        <th className="px-4 py-2 text-right">Anbefalt</th>
                        <th className="px-4 py-2 text-right">Verdi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map(l => (
                        <tr key={l.raw_material_id} className="border-t border-line-subtle">
                          <td className="px-4 py-2">
                            <div className="font-medium">{l.name}</div>
                            <div className="font-mono text-xs text-ink-secondary">
                              {l.supplier_sku ?? l.sku}
                            </div>
                          </td>
                          <td className={`px-4 py-2 text-right tabular-nums ${l.disponibelt < 0 ? "text-destructive" : ""}`}>
                            {formatNumber(l.disponibelt, 2)} {l.base_unit}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                            {l.min_stock == null ? "—" : formatNumber(l.min_stock, 2)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">
                            {l.package_size != null ? (
                              <>
                                {l.packages} × {formatNumber(l.package_size, 2)} {l.package_unit ?? l.base_unit}
                                <Badge variant="outline" className="ml-2">
                                  {formatNumber(l.order_base_qty, 2)} {l.base_unit}
                                </Badge>
                              </>
                            ) : (
                              <>
                                {formatNumber(l.order_base_qty, 2)} {l.base_unit}
                                <span className="ml-2 text-xs font-normal text-ink-secondary">
                                  <PackagePlus className="mr-1 inline h-3 w-3" /> pakning mangler
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{kr(l.line_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
