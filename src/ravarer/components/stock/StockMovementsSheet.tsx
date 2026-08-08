import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useStockMovements } from "@/ravarer/hooks/useStock";
import { movementLabel, movementSourceLink } from "@/ravarer/lib/stock";
import { formatNumber } from "@/ravarer/lib/constants";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawMaterial: { id: string; name: string; base_unit: string } | null;
}

function fmtDateTime(v: string) {
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(v));
}

export function StockMovementsSheet({ open, onOpenChange, rawMaterial }: Props) {
  const { data, isLoading } = useStockMovements(open ? rawMaterial?.id : undefined);
  const rows = data?.rows ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bevegelser</SheetTitle>
          <SheetDescription>{rawMaterial?.name}</SheetDescription>
        </SheetHeader>

        <div className="mt-5">
          {isLoading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-secondary">Ingen bevegelser registrert ennå.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="py-2">Dato</th>
                  <th className="py-2">Type</th>
                  <th className="py-2 text-right">Antall</th>
                  <th className="py-2">Kilde</th>
                  <th className="py-2">Notat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(m => {
                  const link = movementSourceLink(m.source_table, m.source_id, data?.invoiceIdByLineId);
                  const qty = Number(m.quantity_base) || 0;
                  return (
                    <tr key={m.id} className="border-t border-line-subtle align-top">
                      <td className="py-2 whitespace-nowrap text-ink-secondary">{fmtDateTime(m.occurred_at)}</td>
                      <td className="py-2"><Badge variant="outline">{movementLabel(m.movement_type)}</Badge></td>
                      <td className={`py-2 text-right tabular-nums font-medium ${qty < 0 ? "text-destructive" : ""}`}>
                        {qty > 0 ? "+" : ""}{formatNumber(qty, 3)} <span className="text-xs text-ink-secondary">{rawMaterial?.base_unit}</span>
                      </td>
                      <td className="py-2">
                        {link ? (
                          <Link to={link.to} className="text-primary hover:underline">{link.label}</Link>
                        ) : (
                          <span className="text-ink-secondary">{m.source_table === "manual" ? "Manuell" : "—"}</span>
                        )}
                      </td>
                      <td className="py-2 text-ink-secondary">{m.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
