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
    queryFn: async (): Promise<CustomerBasisRow[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          total_incl_vat,
          invoice_recipient_customer_id,
          customer_id,
          status,
          is_return,
          delivery_date,
          customers:customer_id(id, name, customer_profile_id, profile_overrides, customer_profiles(invoicing_group)),
          recipient:invoice_recipient_customer_id(id, name, customer_profile_id, profile_overrides, customer_profiles(invoicing_group))
        `)
        .eq("legal_entity_id", entityId!)
        .lte("delivery_date", runDate)
        .limit(2000);
      if (error) throw error;

      const buckets = new Map<string, CustomerBasisRow>();
      for (const o of (data ?? []) as any[]) {
        const isReturn = o.is_return === true;
        const okStatus = isReturn
          ? ["confirmed", "delivered"].includes(o.status)
          : o.status === "delivered";
        if (!okStatus) continue;
        const rec = o.recipient ?? o.customers;
        if (!rec) continue;
        const grp = rec.profile_overrides?.invoicing_group
          ?? rec.customer_profiles?.invoicing_group
          ?? null;
        if (selectedGroups.length && !selectedGroups.includes(grp ?? "__none")) continue;
        const key = rec.id as string;
        const existing = buckets.get(key);
        if (existing) {
          existing.order_count += 1;
          existing.sum_incl_vat += Number(o.total_incl_vat ?? 0);
        } else {
          buckets.set(key, {
            recipient_id: key,
            customer_name: rec.name ?? "—",
            invoicing_group: grp,
            order_count: 1,
            sum_incl_vat: Number(o.total_incl_vat ?? 0),
          });
        }
      }
      return Array.from(buckets.values()).sort((a, b) => a.customer_name.localeCompare(b.customer_name, "no"));
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
