import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc } from "@/lib/pendingRpc";
import { NEW_ITEM_TYPE_LABEL, NEW_ITEM_TYPES, isNewItemType, type NewItemType } from "@/ravarer/lib/fraFaktura/newItems";

/** Regellinjen når én leverandør er valgt (D2): hva nye varer blir, og «Aldri en vare». */
export function SupplierRuleBar({ supplierId, supplierName, rule, rulesAvailable, canWrite }: {
  supplierId: string; supplierName: string; rule: NewItemType | null; rulesAvailable: boolean; canWrite: boolean;
}) {
  const id = useId();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const never = useQuery({
    queryKey: ["ravarer", "fra-faktura", "never", company?.id ?? null, supplierId],
    enabled: !!company,
    queryFn: async () => {
      const { data, error: e } = await supabase.from("invoice_line_exclusion_patterns").select("id, pattern_value")
        .eq("legal_entity_id", company!.id).eq("supplier_id", supplierId).order("pattern_value");
      if (e) throw e;
      return data ?? [];
    },
  });
  const save = async (v: string) => {
    if (lock.current || !rulesAvailable || !canWrite) return;
    lock.current = true; setError(null);
    const r = await callPendingRpc("rm_set_supplier_new_item_type", { p_supplier_id: supplierId, p_type: isNewItemType(v) ? v : null });
    lock.current = false;
    if (r.kind !== "ok") setError(r.kind === "denied" ? "Du har ikke skrivetilgang." : "Regelen ble ikke lagret. Prøv igjen.");
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "supplier-rules"] });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-line-subtle px-4 py-3 text-sm">
      <span className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Regler for {supplierName}</span>
      <span className="flex items-center gap-2">
        <label htmlFor={id}>Nye varer herfra blir</label>
        <select id={id} value={rule ?? ""} disabled={!rulesAvailable || !canWrite} onChange={(e) => void save(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">som foreslått</option>
          {NEW_ITEM_TYPES.map((t) => <option key={t} value={t}>{NEW_ITEM_TYPE_LABEL[t]}</option>)}
        </select>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-ink-secondary">Aldri en vare:</span>
        {never.isLoading ? <span className="text-caption text-ink-secondary">…</span>
          : never.isError ? <span className="text-caption text-destructive">kunne ikke hentes</span>
          : (never.data ?? []).length === 0 ? <span className="text-caption text-ink-secondary">ingen ennå</span>
          : (never.data ?? []).map((p) => <span key={p.id} className="rounded-full bg-warning/15 px-2 py-0.5 text-caption font-semibold text-warning">{p.pattern_value}</span>)}
      </span>
      <span className="text-caption text-ink-secondary">«Ikke vare» på en rad legger den til her.</span>
      {!rulesAvailable && <span className="text-caption text-ink-secondary">Valget for nye varer kan lagres når databaseendringen «Fra faktura» er kjørt.</span>}
      {error && <span role="alert" className="text-caption text-destructive">{error}</span>}
    </div>
  );
}
