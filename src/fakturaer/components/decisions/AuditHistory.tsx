import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { auditActionLabel } from "@/ravarer/lib/labels";

const CASE_STATUS: Record<string, string> = { open: "Åpen", resolved: "Løst", cancelled: "Avbrutt" };

export type AuditRow = { id: string; occurred_at: string; action: string; actor: string | null; is_system: boolean; reason: string | null; changes: Record<string, unknown> };

export type AuditKind = "invoice" | "supplier_link" | "supplier_case" | "invoice_line" | "supplier" | "raw_material";

/** Komponentens `kind` → `p_entity_type` i `rm_audit_history`. */
export const AUDIT_ENTITY_TYPE: Record<AuditKind, string> = {
  invoice: "invoice",
  supplier_link: "raw_material_supplier",
  supplier_case: "supplier_deviation_case",
  invoice_line: "invoice_line",
  supplier: "supplier",
  raw_material: "raw_material",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Typet lesing av `rm_audit_history`-rader. */
export function parseAuditRows(rows: readonly { id: string; occurred_at: string; action: string; actor: string | null; is_system: boolean | null; reason: string | null; changes: unknown }[] | null): AuditRow[] {
  return (rows ?? []).map((r) => ({
    id: r.id, occurred_at: r.occurred_at, action: r.action, actor: r.actor, is_system: !!r.is_system, reason: r.reason,
    changes: isRecord(r.changes) ? r.changes : {},
  }));
}

export function auditDetail(r: Pick<AuditRow, "action" | "changes">): string | null {
  const c = r.changes;
  if (r.action === "supplier_link.changed") return `${String(c.from_name ?? "?")} → ${String(c.to_name ?? "?")}${Array.isArray(c.changed_line_ids) ? `, ${c.changed_line_ids.length} åpne linjer flyttet` : ""}${c.locked_lines ? `, ${String(c.locked_lines)} førte linjer urørt` : ""}`;
  if (r.action === "supplier_case.status") return `${CASE_STATUS[String(c.from ?? "")] ?? "?"} → ${CASE_STATUS[String(c.to ?? "")] ?? "?"}`;
  if (r.action === "supplier_case.credit_allocated" && c.amount_excl_vat != null) return `${Number(c.amount_excl_vat).toLocaleString("nb-NO", { style: "currency", currency: "NOK" })} ekskl. mva.`;
  if (r.action === "supplier_case.created" && c.lines != null) return `${String(c.lines)} linjer`;
  if (r.action === "invoice_line_match_confirmed") return c.package_confirmed ? "Pakning bekreftet" : null;
  return null;
}

/** Endringslogg fra revisjonsloggen via `rm_audit_history` (alle brukeres hendelser, ikke bare egne). */
export function AuditHistory({ entityId, kind }: { entityId: string; kind: AuditKind }) {
  const { data: company } = useCompany();
  const q = useQuery({
    queryKey: ["audit-history", kind, entityId, company?.id ?? null],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rm_audit_history", {
        p_legal_entity_id: company?.id as string, p_entity_type: AUDIT_ENTITY_TYPE[kind], p_entity_id: entityId, p_limit: 100,
      });
      if (error) throw new Error("Kunne ikke hente historikken");
      return parseAuditRows(data);
    },
  });
  if (q.isLoading || !company) return <p className="text-sm text-ink-secondary">Henter historikk …</p>;
  if (q.isError) return <p className="text-sm text-destructive">Kunne ikke hente historikken. <button type="button" className="underline" onClick={() => q.refetch()}>Prøv igjen</button></p>;
  if (!q.data?.length) return <p className="text-sm text-ink-secondary">Ingen registrerte endringer.</p>;
  return (
    <ol className="space-y-1 text-sm">
      {q.data.map((r) => {
        const d = auditDetail(r);
        return (
          <li key={r.id}>
            <span className="tabular-nums text-ink-secondary">{format(new Date(r.occurred_at), "EEE d. MMM yyyy, HH:mm", { locale: nb })}</span>{" "}
            <strong>{auditActionLabel(r.action)}</strong>
            {r.actor ? ` av ${r.actor}` : ""}
            {d ? ` · ${d}` : ""}
            {r.reason ? ` · «${r.reason}»` : ""}
          </li>
        );
      })}
    </ol>
  );
}
