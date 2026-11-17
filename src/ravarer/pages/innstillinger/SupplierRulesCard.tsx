import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callPendingRpc } from "@/lib/pendingRpc";
import { useSupplierNames, useSupplierNewItemRules } from "@/ravarer/hooks/useFraFaktura";
import { NEW_ITEM_TYPE_LABEL, NEW_ITEM_TYPES, isNewItemType } from "@/ravarer/lib/fraFaktura/newItems";

/** Leverandørregler («nye varer herfra blir …»), samlet. Settes også i regellinjen når én leverandør er valgt i Nye varer. */
export function SupplierRulesCard({ canWrite }: { canWrite: boolean }) {
  const id = useId();
  const qc = useQueryClient();
  const q = useSupplierNewItemRules();
  const names = useSupplierNames();
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const rules = [...(q.data?.rules ?? new Map()).entries()].sort((a, b) => (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? "", "nb"));
  const save = async (supplierId: string, v: string) => {
    if (lock.current || !canWrite) return;
    lock.current = true; setError(null);
    const r = await callPendingRpc("rm_set_supplier_new_item_type", { p_supplier_id: supplierId, p_type: isNewItemType(v) ? v : null });
    lock.current = false;
    if (r.kind !== "ok") setError(r.kind === "denied" ? "Du har ikke skrivetilgang." : "Regelen ble ikke lagret. Prøv igjen.");
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "supplier-rules"] });
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id={`${id}-h`} className="text-body font-semibold">Leverandørregler for nye varer</h2>
      {q.isError ? <p role="alert" className="text-sm text-destructive">Reglene kunne ikke leses.</p>
        : !q.data ? <p className="text-sm text-ink-secondary">Henter reglene …</p>
        : !q.data.available ? <p className="text-sm text-ink-secondary">Leverandørregler kan lagres når databaseendringen «Fra faktura» er kjørt.</p>
        : rules.length === 0 ? <p className="text-sm text-ink-secondary">Ingen leverandørregler ennå. Velg en leverandør i Fra faktura › Nye varer for å sette en.</p>
        : (
          <ul className="divide-y divide-line-subtle">
            {rules.map(([sid, rule]) => (
              <li key={sid} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <label htmlFor={`${id}-${sid}`}>Nye varer fra <strong>{names.get(sid) ?? "ukjent leverandør"}</strong> blir</label>
                <select id={`${id}-${sid}`} value={rule} disabled={!canWrite} onChange={(e) => void save(sid, e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">som foreslått</option>
                  {NEW_ITEM_TYPES.map((t) => <option key={t} value={t}>{NEW_ITEM_TYPE_LABEL[t]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </section>
  );
}
