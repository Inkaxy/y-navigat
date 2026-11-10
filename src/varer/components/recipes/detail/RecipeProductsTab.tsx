import { useState } from "react";
import { RecipeSection } from "@/varer/components/recipes/editor/RecipeSections";
import { QueryState } from "@/components/common/QueryState";
import type { RecipeCostTotals } from "@/varer/lib/recipeCost";
import type { ProductMargins } from "@/varer/hooks/useProductCalc";
import type { RecipeProductLinkRow } from "@/varer/hooks/useRecipeProductLinks";
import { nKr, nNum } from "@/varer/lib/calcFormat";
import { LinkProductPicker, UnlinkConfirmDialog } from "./LinkProductControls";
import { ProfitTable, type ProfitRow } from "./ProfitTable";

interface LinksState {
  rows: RecipeProductLinkRow[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  retry: () => void;
}

/**
 * Fanen «Varer og lønnsomhet»: kostgrunnlag, koblede varer med Brutto og DG2
 * per prisnivå, og «Koble til produkt»/«Koble fra». Alle marginer kommer fra
 * `product_margins`; her regnes bare kilopris (pris / registrert vekt).
 */
export function RecipeProductsTab({
  links,
  rows,
  primary,
  cost,
  currentProductId,
  canWrite,
  picker,
  onAdd,
  onRemove,
  busy,
}: {
  links: LinksState;
  rows: ProfitRow[];
  primary: { name: string; state: "loading" | "error" | "ready" | "none"; margins: ProductMargins | undefined };
  cost: RecipeCostTotals;
  currentProductId: string | null;
  canWrite: boolean;
  picker: { products: { id: string; display_name: string | null; display_number: number | null }[]; isLoading: boolean; isError: boolean };
  onAdd: (productId: string) => Promise<boolean>;
  onRemove: (linkId: string) => void;
  busy: boolean;
}) {
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);
  const linkedIds = new Set(links.rows.map((l) => l.product_id));

  return (
    <div className="space-y-6">
      <CostBasis cost={cost} primary={primary} />

      <RecipeSection
        id="seksjon-koblinger"
        title="Koblede varer"
        actions={
          canWrite ? (
            <LinkProductPicker
              products={picker.products}
              isLoading={picker.isLoading}
              isError={picker.isError}
              linkedIds={linkedIds}
              busy={busy}
              onPick={onAdd}
            />
          ) : undefined
        }
      >
        <p className="text-caption text-muted-foreground">
          Samme oppskrift, ulike priser og tillegg. Brutto = (pris − råvare) / pris. DG2 = (pris − råvare − lønn − energi) / pris.
          Tallene regnes i databasen. Priser er eks. mva.
        </p>
        <QueryState
          scope="oppskrift:koblede-varer"
          isLoading={links.isLoading}
          isError={links.isError}
          error={links.error}
          onRetry={links.retry}
          isEmpty={links.rows.length === 0}
          emptyTitle="Ingen varer er koblet til oppskriften ennå."
          errorTitle="Kunne ikke hente koblede varer"
          skeletonRows={2}
        >
          <ProfitTable
            rows={rows}
            currentProductId={currentProductId}
            canWrite={canWrite}
            busy={busy}
            onUnlink={setPendingRemove}
          />
        </QueryState>
      </RecipeSection>

      <UnlinkConfirmDialog pending={pendingRemove} onCancel={() => setPendingRemove(null)} onConfirm={onRemove} />
    </div>
  );
}

function CostBasis({ cost, primary }: {
  cost: RecipeCostTotals;
  primary: { name: string; state: "loading" | "error" | "ready" | "none"; margins: ProductMargins | undefined };
}) {
  const c = primary.margins?.cost;
  const prefix = cost.incomplete ? (cost.unverifiedCount > 0 ? "Foreløpig " : "Minst ") : "";
  return (
    <section aria-labelledby="kostgrunnlag-tittel" className="space-y-2">
      <h2 id="kostgrunnlag-tittel" className="border-b border-line-subtle pb-1.5 font-display text-title text-foreground">Kostgrunnlag</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <dl className="rounded-md border border-border bg-card p-3 text-body">
          <dt className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">Oppskriften</dt>
          <Row k="Råvarekost per bakst" v={`${prefix}${nKr(cost.totalCost)}`} />
          <Row k="Råvarekost per emne" v={cost.costPerUnit != null ? nKr(cost.costPerUnit) : "Ukjent"} />
          {cost.incomplete && (
            <dd className="mt-1 text-caption text-warning">
              Ufullstendig — {cost.missing.length} linje{cost.missing.length === 1 ? "" : "r"} mangler grunnlag.
            </dd>
          )}
        </dl>
        <dl className="rounded-md border border-border bg-card p-3 text-body">
          <dt className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            {primary.state === "none" ? "Primærvare" : `Primærvare · ${primary.name}`}
          </dt>
          {primary.state === "none" ? (
            <dd className="text-caption text-muted-foreground">Ingen vare er koblet til oppskriften.</dd>
          ) : primary.state === "loading" ? (
            <dd className="text-caption text-muted-foreground">Henter kalkyle …</dd>
          ) : primary.state === "error" ? (
            <dd className="text-caption text-destructive" role="alert">Kalkylen kunne ikke hentes. Tallene er ukjente.</dd>
          ) : !primary.margins?.has_cost ? (
            <dd className="text-caption text-warning">
              Mangler kalkyle. {(c?.notes ?? []).filter((n) => n.trim()).join(" ") || "Grunnlaget er ufullstendig."}
            </dd>
          ) : (
            <>
              <Row k="Råvare per enhet" v={nKr(c?.raw_cost)} />
              <Row k="Arbeid per enhet" v={nKr(c?.labor_cost)} />
              <Row k="Energi per enhet" v={nKr(c?.energy_cost)} />
              <Row k="Emballasje per enhet" v={nKr(c?.packaging_cost)} />
              <Row k="Selvkost per enhet" v={nKr(c?.cost_price)} strong />
              {c?.units_per_batch != null && <Row k="Antall per bakst" v={nNum(c.units_per_batch, 0)} />}
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <dd className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{v}</span>
    </dd>
  );
}
