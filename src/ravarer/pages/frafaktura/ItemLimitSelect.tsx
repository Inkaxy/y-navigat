import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callPendingRpc } from "@/lib/pendingRpc";

const CHOICES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

/** Egen prishopp-grense for én vare (overstyrer selskapets grense). Bare godkjennere, bare når SQL-en er kjørt. */
export function ItemLimitSelect({ rawMaterialId, current, companyLimit }: { rawMaterialId: string; current: number | null; companyLimit: number }) {
  const id = useId();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const save = async (v: string) => {
    if (lock.current) return;
    lock.current = true; setErr(null);
    const r = await callPendingRpc("rm_set_item_price_jump", { p_raw_material_id: rawMaterialId, p_pct: v === "" ? null : Number(v) });
    lock.current = false;
    if (r.kind !== "ok") setErr(r.kind === "denied" ? "Bare godkjennere kan sette egen grense." : "Grensen ble ikke lagret.");
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
  };
  return (
    <span className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
      <label htmlFor={id}>Grense for denne varen</label>
      <select id={id} value={current ?? ""} onChange={(e) => void save(e.target.value)}
        className="h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">Som for alle ({companyLimit} %)</option>
        {[...new Set([...CHOICES, ...(current != null ? [current] : [])])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} %</option>)}
      </select>
      {err && <span role="alert" className="text-destructive">{err}</span>}
    </span>
  );
}
