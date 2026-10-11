import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { formatDate } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";

const STATUS: Record<string, string> = {
  draft: "Kladd", invited: "Sendt ut", in_progress: "Pågår", awaiting_confirmation: "Venter bekreftelse", concluded: "Avsluttet", cancelled: "Kansellert",
};
type Row = { id: string; title: string; status: string; mode: string; createdAt: string };

/** Forhandlinger leverandøren er invitert til. Kun visning og lenker til eksisterende forhandlingsflyt. */
export function SupplierNegotiationsSection({ supplierId }: { supplierId: string }) {
  const q = useQuery({
    queryKey: ["supplier-negotiations", supplierId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("negotiation_recipients")
        .select("negotiation:negotiations!inner(id, title, status, negotiation_mode, created_at)")
        .eq("supplier_id", supplierId)
        .limit(500);
      if (error) throw error;
      const seen = new Map<string, Row>();
      for (const r of data ?? []) {
        const n = r.negotiation;
        if (n && !seen.has(n.id)) seen.set(n.id, { id: n.id, title: n.title, status: n.status, mode: n.negotiation_mode, createdAt: n.created_at });
      }
      return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  });
  const href = (r: Row) => (r.mode === "live" && r.status !== "concluded" && r.status !== "cancelled" ? paths.liveForhandling(r.id) : paths.forhandling(r.id));
  const columns: Column<Row>[] = [
    { id: "title", header: "Forhandling", alwaysVisible: true, cell: (r) => <Link to={href(r)} className="font-medium hover:underline">{r.title}</Link> },
    { id: "mode", header: "Type", cell: (r) => (r.mode === "live" ? "Live" : "Forespørsel") },
    { id: "status", header: "Status", cell: (r) => STATUS[r.status] ?? "Ukjent status" },
    { id: "created", header: "Opprettet", cell: (r) => formatDate(r.createdAt) },
  ];
  return (
    <div className="space-y-3">
      <DataTable ariaLabel="Forhandlinger" rows={q.data} columns={columns} getId={(r) => r.id} isLoading={q.isLoading} error={q.error}
        onRetry={() => void q.refetch()} emptyText="Leverandøren er ikke med i noen forhandlinger."
        renderMobileCard={(r) => (
          <Link to={href(r)} className="block min-h-[44px]">
            <span className="block font-medium">{r.title}</span>
            <span className="text-caption text-ink-secondary">{STATUS[r.status] ?? "Ukjent status"} · {formatDate(r.createdAt)}</span>
          </Link>
        )}
      />
      <Link to={paths.forhandlinger()} className="inline-flex min-h-[44px] items-center text-sm text-primary hover:underline md:min-h-0">Alle forhandlinger</Link>
    </div>
  );
}
