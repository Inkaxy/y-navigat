import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { callPendingRpc, pendingSelect } from "@/lib/pendingRpc";
import { formatNok } from "@/ravarer/lib/constants";
import { dateNo } from "@/ravarer/lib/decisions";
import { agreementStatusLabel, derivedPackagePrice, packageLabel } from "@/ravarer/lib/supplierPackagePrice";
import { useSetPrimarySupplier } from "@/ravarer/hooks/useSupplierLinkRpcs";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import {
  COST_RULES, COST_RULE_LABEL, cheapestSupplier, costRuleExplanation, lastPurchaseBySupplier, parseCostRule, recognizedBy, type CostRule,
} from "@/ravarer/lib/fraFaktura/supplierPurchases";
import type { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";

type Page = ReturnType<typeof useRawMaterialPage>;
type Link = Page["links"][number];

/** «Leverandører og innkjøpspris» (D5): én linje per leverandør, hovedleverandør og hva kalkylen bruker. */
export function SupplierPurchases({ rmId, baseUnit, links, nameOf, canWrite, canApprove }: {
  rmId: string; baseUnit: string; links: readonly Link[]; nameOf: ReadonlyMap<string, string>; canWrite: boolean; canApprove: boolean;
}) {
  const id = useId();
  const qc = useQueryClient();
  const setPrimary = useSetPrimarySupplier();
  const ids = links.map((l) => l.id);
  const aliases = useQuery({
    queryKey: ["ravarer", "supplier-purchases", "aliases", rmId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_material_supplier_aliases").select("raw_material_supplier_id, alias_type, alias_value")
        .in("raw_material_supplier_id", ids).eq("status", "confirmed").order("last_seen_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["ravarer", "supplier-purchases", "history", rmId],
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_material_price_history").select("supplier_id, price, effective_date, snapshot_unit, is_credit")
        .eq("raw_material_id", rmId).is("superseded_at", null).eq("is_legacy", false).not("supplier_id", "is", null)
        .order("effective_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rule = useQuery({
    queryKey: ["ravarer", "supplier-purchases", "rule", rmId],
    queryFn: async () => {
      const r = await pendingSelect("raw_materials", `select=cost_basis_rule&id=eq.${encodeURIComponent(rmId)}`);
      if (r.kind === "missing") return { available: false, rule: "hovedleverandor" as CostRule };
      if (r.kind !== "ok" || !Array.isArray(r.data)) throw new Error("Valget kunne ikke leses");
      const row: unknown = r.data[0];
      const v = row && typeof row === "object" && "cost_basis_rule" in row ? row.cost_basis_rule : null;
      return { available: true, rule: parseCostRule(v) };
    },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const saveRule = async (v: string) => {
    if (lock.current) return;
    lock.current = true; setMsg(null);
    const r = await callPendingRpc("rm_set_cost_basis_rule", { p_raw_material_id: rmId, p_rule: parseCostRule(v) });
    lock.current = false;
    if (r.kind !== "ok") setMsg(r.kind === "denied" ? "Bare godkjennere kan endre hva kalkylen bruker." : "Valget ble ikke lagret. Utfallet er ukjent – last varen på nytt.");
    void qc.invalidateQueries({ queryKey: ["ravarer", "supplier-purchases", "rule", rmId] });
    invalidateRawMaterial(qc, rmId);
  };

  const last = lastPurchaseBySupplier(history.data ?? [], baseUnit);
  const primary = links.find((l) => l.is_primary) ?? null;
  const primaryName = primary ? nameOf.get(primary.supplier_id) ?? null : null;
  const cheapId = cheapestSupplier(last);
  const r = rule.data?.rule ?? "hovedleverandor";
  const usedSupplier = r === "billigste" ? cheapId : primary?.supplier_id ?? null;
  const usedPrice = usedSupplier ? last.get(usedSupplier) : undefined;
  const aliasOf = (l: Link) => (aliases.data ?? []).filter((a) => a.raw_material_supplier_id === l.id).map((a) => ({ type: a.alias_type, value: a.alias_value }));

  return (
    <section className="space-y-2" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Leverandører og innkjøpspris</h3>
      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`${id}-r`}>Kalkylen bruker</label>
          <select id={`${id}-r`} value={r} disabled={!rule.data?.available || !canApprove} onChange={(e) => void saveRule(e.target.value)}
            className="h-11 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {COST_RULES.map((c) => <option key={c} value={c}>{COST_RULE_LABEL[c]}</option>)}
          </select>
          {usedPrice?.comparable && r !== "avtalt" && <span className="font-semibold tabular-nums">{formatNok(usedPrice.price)}/{baseUnit}</span>}
        </div>
      )}
      {links.length === 0 ? <p className="text-sm text-ink-secondary">Ingen leverandør koblet.</p> : (
        <ul className="divide-y divide-line-subtle text-sm">
          {links.map((l) => {
            const d = derivedPackagePrice(l);
            const status = agreementStatusLabel(l);
            const p = last.get(l.supplier_id);
            const rec = recognizedBy(l.supplier_sku ?? null, aliasOf(l));
            return (
              <li key={l.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{nameOf.get(l.supplier_id) ?? "Ukjent leverandør"}</div>
                    <div className="text-caption text-ink-secondary">{l.supplier_sku ? `varenr ${l.supplier_sku}` : "uten varenummer"}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    {history.isError ? <span className="text-caption text-destructive">Pris kunne ikke hentes</span>
                      : history.isLoading ? <span className="text-caption text-ink-secondary">…</span>
                      : p ? <><div className="font-semibold">{p.comparable ? `${formatNok(p.price)}/${baseUnit}` : "Annen enhet"}</div><div className="text-caption text-ink-secondary">sist {dateNo(p.date)}</div></>
                      : <span className="text-caption text-ink-secondary">Ingen kjøp ennå</span>}
                  </div>
                </div>
                {aliases.isError ? <p className="text-caption text-destructive">Skrivemåtene kunne ikke hentes.</p>
                  : rec.length > 0 && <p className="text-caption text-ink-secondary">Kjennes igjen på: {rec.join(" · ")}</p>}
                <div className="text-caption text-ink-secondary">{packageLabel(l, baseUnit).label ?? "Pakning ukjent"}</div>
                {l.agreed_price_per_base_unit != null && (
                  <div className="text-caption tabular-nums">
                    Avtale {formatNok(l.agreed_price_per_base_unit)} / {baseUnit}
                    {d.kind === "known" ? ` · ${formatNok(d.price)} per pakning (avledet)` : d.kind === "needs_confirmation" ? " · pakningsgrunnlag må bekreftes" : ""}
                    {status && <span className="block text-warning">{status}</span>}
                  </div>
                )}
                {l.is_primary
                  ? <span className="inline-block rounded-full bg-success/15 px-2 py-0.5 text-caption font-semibold text-success">Hovedleverandør</span>
                  : canWrite && links.length > 1 && (
                    <Button size="sm" variant="outline" className="min-h-[44px]" disabled={setPrimary.isPending}
                      onClick={() => setPrimary.mutate({ rawMaterialId: rmId, supplierId: l.supplier_id })}>Gjør til hovedleverandør</Button>
                  )}
              </li>
            );
          })}
        </ul>
      )}
      {links.length > 0 && rule.data?.available && <p className="text-caption text-ink-secondary">{costRuleExplanation(r, primaryName, cheapId ? { name: nameOf.get(cheapId) ?? "ukjent leverandør" } : null)}</p>}
      {rule.data && !rule.data.available && links.length > 0 && <p className="text-caption text-ink-secondary">Valget «Kalkylen bruker» kan endres når databaseendringen «Fra faktura» er kjørt. Til da bruker kalkylen siste gyldige kjøp uansett leverandør.</p>}
      {rule.isError && <p role="alert" className="text-caption text-destructive">Kunne ikke lese hva kalkylen bruker.</p>}
      {msg && <p role="alert" className="text-caption text-destructive">{msg}</p>}
    </section>
  );
}
