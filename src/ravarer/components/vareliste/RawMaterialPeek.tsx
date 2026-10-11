import { Link } from "react-router-dom";
import { PeekPanel } from "@/ravarer/ui/SplitView";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { useRawMaterialPage } from "@/ravarer/hooks/useRawMaterialPage";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { formatDate, formatNok, priceSourceLabel } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { completenessChecklist, sectionSearch, type SectionId } from "@/ravarer/lib/rawMaterialSections";
import { agreementStatusLabel, derivedPackagePrice, packageLabel } from "@/ravarer/lib/supplierPackagePrice";
import { ChecklistCard } from "@/ravarer/components/detail/Completeness";
import { useMaterialPriceEvidence } from "@/ravarer/hooks/useMaterialPriceEvidence";
import { costSummary } from "@/ravarer/lib/costSummary";


/**
 * Peek for valgt råvare i varearbeidsflaten: panelet ved siden av listen fra 1280 px,
 * og hele bredden under 1280 px (SplitView). Samme felles henting som råvarekortet;
 * delspørringsfeil vises, aldri som «mangler».
 */
export function RawMaterialPeek({ id, listSearch, onClose }: { id: string | null; listSearch: string; onClose: () => void }) {
  const sp = new URLSearchParams(listSearch);
  return (
    <PeekPanel title={id ? <PeekTitle id={id} /> : undefined} fullHref={id ? `${paths.raavare(id)}${sectionSearch(sp, "sammendrag")}` : undefined} onClose={id ? onClose : undefined} emptyText="Velg en vare i listen">
      {id ? <PeekBody id={id} listSearch={listSearch} /> : null}
    </PeekPanel>
  );
}

function PeekTitle({ id }: { id: string }) {
  const page = useRawMaterialPage(id);
  return <>{page.rm?.name ?? "Råvare"}</>;
}

function PeekBody({ id, listSearch }: { id: string; listSearch: string }) {
  const page = useRawMaterialPage(id);
  const { data: suppliers = [] } = useSuppliers();
  const rm = page.rm;
  const sp = new URLSearchParams(listSearch);
  const href = (s: SectionId) => `${paths.raavare(id)}${sectionSearch(sp, s)}`;
  // Peekens ene eier av prisbevis (samme delte hook/cache som råvarekortet).
  const priceEvidence = useMaterialPriceEvidence(rm ?? null);
  if (page.isLoading || page.isError || !rm) {
    return (
      <QueryState isLoading={page.isLoading} isError={page.isError} error={page.error} onRetry={() => page.refetch()} scope="Råvaren" isEmpty={!rm} emptyTitle="Råvaren ble ikke funnet">
        {null}
      </QueryState>
    );
  }
  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
  const checklist = completenessChecklist({ rm, linkCount: page.links.length, nutrition: page.nutrition, hasDatasheet: page.hasDatasheet, costEvidence: priceEvidence.cost });
  const cost = costSummary(rm, priceEvidence.cost);
  return (
    <div className="space-y-5">
      <p className="text-caption text-ink-secondary">SKU {rm.sku} · {rm.base_unit}{rm.is_active ? "" : " · Inaktiv"}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="min-h-[44px]"><Link to={href("pris")}>Pris</Link></Button>
        <Button asChild size="sm" variant="outline" className="min-h-[44px]"><Link to={href("leverandorer")}>Leverandører</Link></Button>
      </div>

      <section className="rounded-lg border border-line-subtle p-4">
        <div className="text-caption text-ink-secondary">Kostpris per {rm.base_unit}</div>
        <div className="text-2xl font-semibold tabular-nums">{cost.value}</div>
        <div className={cost.verified ? "text-caption text-success" : "text-caption text-warning"} data-testid="peek-cost-status">{cost.status}</div>
        <div className="text-caption text-ink-secondary">
          {cost.precise && `${cost.precise} · `}{cost.source ?? "Ingen kilde"}
        </div>
      </section>

      <ChecklistCard items={checklist} hrefFor={href} />

      <section className="space-y-2">
        <h3 className="text-base font-semibold">Leverandører</h3>
        {page.links.length === 0 ? <p className="text-sm text-ink-secondary">Ingen leverandør koblet.</p> : (
          <ul className="divide-y divide-line-subtle text-sm">
            {page.links.map((l) => {
              const d = derivedPackagePrice(l);
              const status = agreementStatusLabel(l);
              return (
                <li key={l.id} className="py-2">
                  <div className="font-medium">{nameOf.get(l.supplier_id) ?? "Ukjent leverandør"}{l.is_primary ? " · Primær" : ""}</div>
                  <div className="text-caption text-ink-secondary">{packageLabel(l, rm.base_unit).label ?? "Pakning ukjent"}</div>
                  {l.agreed_price_per_base_unit != null && (
                    <div className="text-caption tabular-nums">
                      Avtale {formatNok(l.agreed_price_per_base_unit)} / {rm.base_unit}
                      {d.kind === "known" ? ` · ${formatNok(d.price)} per pakning (avledet)` : d.kind === "needs_confirmation" ? " · pakningsgrunnlag må bekreftes" : ""}
                      {status && <span className="block text-warning">{status}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
