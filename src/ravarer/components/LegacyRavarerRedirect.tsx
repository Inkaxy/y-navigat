import { Link, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { legacyDecisionKeyFromPath, legacyDecisionTarget, resolveLegacyRavarerUrl, withSelected } from "@/ravarer/lib/legacyRoutes";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import { varekortKey } from "@/ravarer/pages/priskontroll/gjore/logic";
import { paths } from "@/ravarer/lib/paths";

type Resolved = { valgt: string | null; missing: boolean };

async function itemExists(le: string, supplierId: string, itemKey: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("rm_supplier_item_lines", { p_legal_entity_id: le, p_supplier_id: supplierId, p_item_key: itemKey, p_limit: 1 });
  if (error) throw new Error("Kunne ikke slå opp varekortet");
  return Array.isArray(data) && data.length > 0;
}

/** Gammel nøkkel eller line:<id> → kanonisk varekort (`valgt=varekort:…`), verifisert mot databasen. */
async function resolveTarget(le: string, rawKey: string): Promise<Resolved> {
  const t = legacyDecisionTarget(rawKey);
  if (!t) return { valgt: null, missing: false };
  if (t.kind === "key") {
    const k = supplierItemKey({ supplier_sku: t.sku });
    if (k && (await itemExists(le, t.supplierId, k))) return { valgt: varekortKey(t.supplierId, k), missing: false };
    return { valgt: null, missing: true };
  }
  const { data, error } = await supabase.from("invoice_lines")
    .select("id, supplier_sku, description, invoices!inner(supplier_id, legal_entity_id)")
    .eq("id", t.lineId).eq("invoices.legal_entity_id", le).maybeSingle();
  if (error) throw new Error("Kunne ikke slå opp linjen");
  const supplierId = data?.invoices?.supplier_id ?? null;
  if (!data || !supplierId) return { valgt: null, missing: true };
  // Varenummer først, ellers navn — samme regel som databasen. Prøv navnet hvis varenummeret ikke gir treff.
  const candidates = [supplierItemKey(data), supplierItemKey({ description: data.description })].filter((k): k is string => !!k);
  for (const k of [...new Set(candidates)]) if (await itemExists(le, supplierId, k)) return { valgt: varekortKey(supplierId, k), missing: false };
  return { valgt: null, missing: true };
}

/** Sender gamle Råvarer-lenker (bokmerker, e-post) videre til ny sti. */
export function LegacyRavarerRedirect() {
  const { pathname, search, hash } = useLocation();
  const { data: company, isLoading: companyLoading } = useCompany();
  const le = company?.id ?? null;
  const rawKey = legacyDecisionKeyFromPath(pathname);
  const base = resolveLegacyRavarerUrl(pathname, search) ?? paths.oversikt();
  const needsLookup = !!rawKey && !!legacyDecisionTarget(rawKey) && !new URLSearchParams(search).has("valgt");
  const q = useQuery({
    queryKey: ["legacy-decision-target", le, rawKey],
    enabled: needsLookup && !!le,
    queryFn: () => resolveTarget(le!, rawKey!),
    retry: false,
  });
  if (!needsLookup || (!companyLoading && !le)) return <Navigate to={`${base}${hash}`} replace />;
  if (q.isPending) return <p className="px-page py-6 text-sm text-ink-secondary">Finner elementet fra den gamle lenken …</p>;
  if (q.isError || q.data?.missing) {
    return (
      <div role="alert" className="mx-auto max-w-lg space-y-3 px-page py-8 text-sm">
        <p className="font-medium">{q.isError ? "Kunne ikke slå opp elementet fra den gamle lenken." : "Elementet fra den gamle lenken finnes ikke lenger."}</p>
        <p className="text-ink-secondary">Det kan være løst, slettet eller koblet om. Du kan åpne Å gjøre med samme leverandør og søk.</p>
        <div className="flex gap-2">
          <Button asChild><Link to={base} replace>Åpne Å gjøre</Link></Button>
          {q.isError && <Button variant="outline" onClick={() => void q.refetch()}>Prøv igjen</Button>}
        </div>
      </div>
    );
  }
  return <Navigate to={`${withSelected(base, q.data?.valgt ?? null)}${hash}`} replace />;
}
