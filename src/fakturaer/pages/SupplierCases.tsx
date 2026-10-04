import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";

const STATUS: Record<string, string> = { open: "Åpen", resolved: "Løst", cancelled: "Avbrutt" };

export default function SupplierCases() {
  const { data: company } = useCompany();
  const q = useQuery({
    queryKey: ["supplier-cases", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_deviation_cases")
        .select("id, title, status, follow_up_on, created_at, supplier:suppliers(name), lines:supplier_deviation_case_lines(invoice_id, amount_excl_vat)")
        .eq("legal_entity_id", company!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <h1 className="font-display text-3xl font-semibold">Leverandørsaker</h1>
      <QueryState isLoading={q.isLoading || !company} isError={q.isError} error={q.error} scope="fakturaer:leverandorsaker" onRetry={() => q.refetch()}
        isEmpty={(q.data ?? []).length === 0} emptyTitle="Ingen leverandørsaker" emptyDescription="Saker opprettes fra et prisavvik under I dag.">
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-card">
          {(q.data ?? []).map((c) => {
            const inv = new Set(c.lines.map((l) => l.invoice_id)).size;
            const sum = c.lines.reduce((s, l) => s + Number(l.amount_excl_vat), 0);
            return (
              <li key={c.id}>
                <Link to={`/ravarer/fakturaer/saker/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/40">
                  <span><span className="block font-medium">{c.title}</span><span className="text-sm text-ink-secondary">{c.supplier?.name} · {inv} fakturaer · {STATUS[c.status] ?? c.status}</span></span>
                  <span className="text-sm text-ink-secondary">
                    {sum.toLocaleString("nb-NO", { style: "currency", currency: "NOK" })} ekskl. mva.
                    {c.follow_up_on ? ` · oppfølging ${format(new Date(c.follow_up_on), "d. MMM yyyy", { locale: nb })}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
}
