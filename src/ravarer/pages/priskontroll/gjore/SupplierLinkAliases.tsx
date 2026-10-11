import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/fakturaer/lib/constants";

const TYPE: Record<string, string> = { sku: "Varenummer", name: "Varenavn", supplier_sku: "Varenummer", description: "Varenavn" };
const STATUS: Record<string, string> = { confirmed: "Bekreftet", pending: "Venter", superseded: "Erstattet", rejected: "Avvist" };

/** Aliaser for leverandørkoblingen — kun visning. */
export function SupplierLinkAliases({ rmsId }: { rmsId: string }) {
  const q = useQuery({
    queryKey: ["supplier-link-aliases", rmsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_supplier_aliases")
        .select("id, alias_type, alias_value, status, last_seen_at, match_count")
        .eq("raw_material_supplier_id", rmsId)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw new Error("Kunne ikke hente aliasene");
      return data ?? [];
    },
  });
  if (q.isLoading) return <p className="text-sm text-ink-secondary">Henter aliaser …</p>;
  if (q.isError) return <p className="text-sm text-destructive">Kunne ikke hente aliasene. <button type="button" className="underline" onClick={() => void q.refetch()}>Prøv igjen</button></p>;
  if (!q.data?.length) return <p className="text-sm text-ink-secondary">Ingen aliaser registrert.</p>;
  return (
    <ul className="divide-y divide-line-subtle text-sm">
      {q.data.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
          <span><span className="text-ink-secondary">{TYPE[a.alias_type] ?? "Alias"}:</span> {a.alias_value}</span>
          <span className="text-caption text-ink-secondary tabular-nums">
            {STATUS[a.status] ?? "Ukjent status"} · sist sett {formatDate(a.last_seen_at)} · {a.match_count ?? 0} treff
          </span>
        </li>
      ))}
    </ul>
  );
}
