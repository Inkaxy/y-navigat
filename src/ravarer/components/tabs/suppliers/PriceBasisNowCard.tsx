import { useQueries } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { osloTodayISO } from "@/lib/osloDate";
import { useCompany } from "@/hooks/useCompany";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { parsePriceReference, type PriceReference } from "@/fakturaer/lib/parseRpcJson";
import { priceReferenceLabel, priceReferenceDateText, priceReferenceReasonText } from "@/ravarer/lib/priceReference";
import { formatNok } from "@/ravarer/lib/constants";

export interface PriceBasisLink {
  id: string;
  supplier_id: string;
  is_primary: boolean | null;
  notes: string | null;
}

interface ViewRow { link: PriceBasisLink; name: string; ref: PriceReference | undefined; loading: boolean; error: boolean }

/** Ren visning — brukes også av utviklingsforhåndsvisningen. */
export function PriceBasisNowView({ rows, baseUnit, tolerancePct, tolIsCategory }: { rows: ViewRow[]; baseUnit: string; tolerancePct: number; tolIsCategory: boolean }) {
  const tol = `${tolerancePct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} % ${tolIsCategory ? "(kategori)" : "(standard)"}`;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-base font-semibold">Prisgrunnlag akkurat nå</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-secondary">Ingen leverandører koblet til denne råvaren.</p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {rows.map(({ link, name, ref, loading, error }) => (
            <li key={link.id} className="space-y-1 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{name}</span>
                {link.is_primary && <Badge variant="outline"><Star className="mr-1 h-3 w-3" aria-hidden />Primær</Badge>}
                <span className="text-ink-secondary">
                  {loading ? "Henter…" : error ? "Kunne ikke hente prisgrunnlag" : ref ? priceReferenceLabel(ref.source) : "—"}
                </span>
                {ref?.price != null && <span className="tabular-nums font-medium">{formatNok(ref.price)} / {baseUnit}</span>}
                {ref && priceReferenceDateText(ref) && <span className="text-caption text-ink-secondary">{priceReferenceDateText(ref)}</span>}
                <span className="ml-auto text-caption text-ink-secondary">Toleranse {tol}</span>
              </div>
              {ref && priceReferenceReasonText(ref) && <p className="text-caption text-ink-secondary">{priceReferenceReasonText(ref)}</p>}
              {link.notes && <p className="text-caption text-ink-secondary">{link.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-ink-secondary">Dette er prisen fakturalinjer sammenlignes med. Rekkefølge: avtalepris → startpris → siste dokumenterte kjøp.</p>
    </Card>
  );
}

export function PriceBasisNowCard({ rawMaterialId, category, baseUnit, links, supplierNames }: {
  rawMaterialId: string;
  category: string | null;
  baseUnit: string;
  links: PriceBasisLink[];
  supplierNames: Map<string, string>;
}) {
  const { data: company } = useCompany();
  const tol = useMatchTolerances(company?.id);
  const today = osloTodayISO();
  const refs = useQueries({
    queries: links.map((l) => ({
      queryKey: ["rm-price-reference", rawMaterialId, l.supplier_id, today],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("rm_price_reference", {
          p_raw_material_id: rawMaterialId, p_supplier_id: l.supplier_id, p_invoice_date: today,
        });
        if (error) throw error;
        return parsePriceReference(data);
      },
    })),
  });
  const rows: ViewRow[] = links.map((link, i) => ({
    link, name: supplierNames.get(link.supplier_id) ?? "Ukjent leverandør",
    ref: refs[i]?.data, loading: !!refs[i]?.isLoading, error: !!refs[i]?.isError,
  }));
  return (
    <PriceBasisNowView rows={rows} baseUnit={baseUnit} tolerancePct={tol.toleranceFor(category)} tolIsCategory={!!category && tol.byCategory[category] != null} />
  );
}
