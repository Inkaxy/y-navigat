import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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

interface CustomerBasisRow {
  recipient_id: string;
  customer_name: string;
  invoicing_group: string | null;
  order_count: number;
  sum_incl_vat: number;
}

export function PreviewDrawer({ open, onOpenChange, entityId, runDate, selectedGroups, previewRows }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["fakturering", "preview-details", entityId, runDate, [...selectedGroups].sort()],
    enabled: open && !!entityId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<CustomerBasisRow[]> => {
      const { data, error } = await (supabase.rpc as any)("get_invoice_run_preview_customers", {
        p_legal_entity_id: entityId,
        p_run_date: runDate,
        p_groups: selectedGroups.length ? selectedGroups : null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        recipient_id: r.recipient_id,
        customer_name: r.customer_name ?? "—",
        invoicing_group: r.invoicing_group ?? null,
        order_count: Number(r.order_count ?? 0),
        sum_incl_vat: Number(r.sum_incl_vat ?? 0),
      }));
    },
  });


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Forhåndsvisning av fakturagrunnlag</SheetTitle>
          <SheetDescription>
            Grunnlag per kunde basert på valgte grupper. Ingenting opprettes.
          </SheetDescription>
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
                    <th className="px-3 py-2 text-left font-semibold">Kunde</th>
                    <th className="px-3 py-2 text-left font-semibold">Gruppe</th>
                    <th className="px-3 py-2 text-right font-semibold">Ordrer</th>
                    <th className="px-3 py-2 text-right font-semibold">Sum inkl. mva</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {data.map((r) => {
                    const def = groupDefFor(r.invoicing_group);
                    const preview = previewRows.find((p) => (p.invoicing_group ?? "__none") === (r.invoicing_group ?? "__none"));
                    void preview;
                    return (
                      <tr key={r.recipient_id}>
                        <td className="px-3 py-2 font-medium text-text-primary">{r.customer_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{def.code} · {def.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.order_count}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKr(r.sum_incl_vat)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
