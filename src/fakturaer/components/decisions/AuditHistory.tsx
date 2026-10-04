import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

const ACTION_LABEL: Record<string, string> = {
  "invoice.internal_approved": "Internt godkjent",
  "invoice.internal_approval_revoked": "Godkjenning trukket tilbake",
  "invoice.safe_costs_posted": "Kostpris ført for trygge linjer",
  "supplier_link.changed": "Kobling endret",
  invoice_line_match_confirmed: "Råvare/pakning bekreftet",
};

interface Row { id: string; occurred_at: string; action: string; reason: string | null; user_display_name: string | null; changes: unknown }

function detail(r: Row): string | null {
  const c = (r.changes ?? {}) as Record<string, unknown>;
  if (r.action === "supplier_link.changed") return `${String(c.from_name ?? "?")} → ${String(c.to_name ?? "?")}${Array.isArray(c.changed_line_ids) ? `, ${c.changed_line_ids.length} åpne linjer flyttet` : ""}${c.locked_lines ? `, ${String(c.locked_lines)} førte linjer urørt` : ""}`;
  if (r.action === "invoice_line_match_confirmed") return c.package_confirmed ? "Pakning bekreftet" : null;
  return null;
}

/** Endringslogg fra revisjonsloggen for en faktura eller en leverandørkobling. */
export function AuditHistory({ entityId, kind }: { entityId: string; kind: "invoice" | "supplier_link" }) {
  const q = useQuery({
    queryKey: ["audit-history", kind, entityId],
    queryFn: async () => {
      let req = supabase.from("audit_log").select("id, occurred_at, action, reason, user_display_name, changes").order("occurred_at", { ascending: false }).limit(50);
      req = kind === "invoice"
        ? req.eq("entity_id", entityId).in("action", ["invoice.internal_approved", "invoice.internal_approval_revoked", "invoice.safe_costs_posted"])
        : req.or(`entity_id.eq.${entityId},changes->>raw_material_supplier_id.eq.${entityId}`);
      const { data, error } = await req;
      if (error) throw new Error("Kunne ikke hente historikken");
      return (data ?? []) as Row[];
    },
  });
  if (q.isLoading) return <p className="text-sm text-ink-secondary">Henter historikk …</p>;
  if (q.isError) return <p className="text-sm text-destructive">Kunne ikke hente historikken. <button type="button" className="underline" onClick={() => q.refetch()}>Prøv igjen</button></p>;
  if (!q.data?.length) return <p className="text-sm text-ink-secondary">Ingen registrerte endringer.</p>;
  return (
    <ol className="space-y-1 text-sm">
      {q.data.map((r) => (
        <li key={r.id}>
          <span className="tabular-nums text-ink-secondary">{format(new Date(r.occurred_at), "EEE d. MMM yyyy, HH:mm", { locale: nb })}</span>{" "}
          <strong>{ACTION_LABEL[r.action] ?? "Endring"}</strong>
          {r.user_display_name ? ` av ${r.user_display_name}` : ""}
          {detail(r) ? ` · ${detail(r)}` : ""}
          {r.reason ? ` · «${r.reason}»` : ""}
        </li>
      ))}
    </ol>
  );
}
