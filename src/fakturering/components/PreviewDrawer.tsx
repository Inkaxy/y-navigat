import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import type { PreviewRow } from "@/fakturering/hooks/useFakturering";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entityId: string | null;
  runDate: string;
  selectedGroups: string[];
  previewRows: PreviewRow[];
}

interface LineRow {
  order_id: string;
  order_number: string;
  customer_number: string | null;
  customer_name: string;
  delivery_date: string;
  tour_number: number | null;
  invoicing_group: string | null;
  sum_excl_vat: number;
  sum_incl_vat: number;
  is_return: boolean;
}

export function PreviewDrawer({ open, onOpenChange, entityId, runDate, selectedGroups }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["fakturering", "preview-lines", entityId, runDate, [...selectedGroups].sort()],
    enabled: open && !!entityId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<LineRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_invoice_run_preview_lines", {
        p_legal_entity_id: entityId,
        p_run_date: runDate,
        p_groups: selectedGroups.length ? selectedGroups : null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        order_id: r.order_id,
        order_number: String(r.order_number ?? ""),
        customer_number: r.customer_number ?? null,
        customer_name: r.customer_name ?? "—",
        delivery_date: r.delivery_date,
        tour_number: r.tour_number ?? null,
        invoicing_group: r.invoicing_group ?? null,
        sum_excl_vat: Number(r.sum_excl_vat ?? 0),
        sum_incl_vat: Number(r.sum_incl_vat ?? 0),
        is_return: !!r.is_return,
      }));
    },
  });

  const groupLabel = useMemo(() => {
    if (selectedGroups.length === 1) {
      const g = groupDefFor(selectedGroups[0]);
      return `${g.code} ${g.label}`;
    }
    if (selectedGroups.length === 0) return "alle grupper";
    return `${selectedGroups.length} grupper`;
  }, [selectedGroups]);

  const runDateLabel = useMemo(() => {
    try {
      return format(new Date(runDate), "dd.MM.yyyy");
    } catch {
      return runDate;
    }
  }, [runDate]);

  const totalExcl = useMemo(() => (data ?? []).reduce((s, r) => s + r.sum_excl_vat, 0), [data]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <SheetTitle className="text-lg">
                Pakksedler til og med {runDateLabel} for faktureringsgruppe{" "}
                <span className="font-semibold">"{groupLabel}"</span>
              </SheetTitle>
              <SheetDescription>
                Grunnlag basert på leverte, ufakturerte ordrer. Ingenting opprettes.
              </SheetDescription>
            </div>
            {data && (
              <Badge className="shrink-0 bg-[hsl(var(--app-primary))] text-white hover:bg-[hsl(var(--app-primary))]">
                {data.length} treff
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6">
          {isLoading && <div className="text-sm text-muted-foreground">Laster…</div>}
          {!isLoading && data && data.length === 0 && (
            <div className="rounded-lg border border-line-subtle bg-surface-sunken p-6 text-center text-sm text-muted-foreground">
              Ingen ordrer klare for de valgte gruppene.
            </div>
          )}
          {!isLoading && data && data.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line-subtle">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Nummer</th>
                    <th className="px-3 py-2 text-left font-semibold">Kundenr</th>
                    <th className="px-3 py-2 text-left font-semibold">Navn</th>
                    <th className="px-3 py-2 text-left font-semibold">Leveransedato</th>
                    <th className="px-3 py-2 text-left font-semibold">Tur</th>
                    <th className="px-3 py-2 text-right font-semibold">Sum (u/mva)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {data.map((r, idx) => (
                    <tr
                      key={r.order_id}
                      className={idx % 2 === 0 ? "bg-transparent" : "bg-surface-sunken/40"}
                    >
                      <td className="px-3 py-2 tabular-nums text-text-primary">{r.order_number}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{r.customer_number ?? "—"}</td>
                      <td className="px-3 py-2 text-text-primary">
                        {r.customer_name}
                        {r.is_return && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                            Retur
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {format(new Date(r.delivery_date), "dd.MM.yyyy")}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {r.tour_number ?? "—"}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.is_return ? "text-red-700" : ""}`}>
                        {formatKr(r.sum_excl_vat)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-surface-sunken">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sum grunnlag (u/mva)
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-text-primary">
                      {formatKr(totalExcl)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
