import { formatKr } from "@/varer/lib/pricing";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cake, ImageOff, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColumnOption } from "@/varer/components/products/ColumnPicker";
import { readinessChips, readinessStatusLabel, type ProductCalcReadinessRow } from "@/varer/lib/readinessChips";
import { CAKE_ROLE_LABEL, LABEL_MODE_OPTIONS, PRODUCT_STATUS_LABEL, type CakeRole, type ProductStatus } from "@/varer/lib/constants";
import type { LabelingStatus } from "@/varer/lib/labelStaleness";
import { LabelingBadge } from "@/varer/components/lists/LabelingBadge";
import { thumbUrl, onThumbError } from "@/varer/lib/thumbUrl";

export type ProductRow = {
  id: string;
  display_number: number;
  code: string;
  display_name: string;
  product_category: string;
  product_subcategory: string | null;
  main_category: { code: string; display_name: string } | null;
  sub_category: { code: string; display_name: string } | null;
  unit_of_sale: string;
  status: ProductStatus;
  variant_of_product_id: string | null;
  variant_label: string | null;
  label_mode: string | null;
  is_cake_component: boolean | null;
  cake_role: CakeRole | null;
  image_url: string | null;
  mva_rate?: number | null;
  pieces_per_tray: number | null;
  in_web_shop: boolean | null;
  in_pos: boolean | null;
  manual_ingredient_declaration: string | null;
  declaration_needs_review: boolean | null;
  declaration_version_id: string | null;
  calc_type: string | null;
  manual_cost_price: number | null;
};

export type CostCacheRow = {
  product_id: string;
  cost_per_unit: number | null;
  has_cost: boolean | null;
  quality: string | null;
  is_stale: boolean | null;
};

export type BulkEditableField = "in_web_shop" | "in_pos";
export const BULK_EDITABLE: Record<string, BulkEditableField> = { in_web_shop: "in_web_shop", in_pos: "in_pos" };

export type RowCtx = {
  parent: ProductRow | null;
  price: number | undefined;
  /** Valgt prisliste lastes fortsatt. */
  priceLoading: boolean;
  costCache: CostCacheRow | undefined;
  readiness: (ProductCalcReadinessRow & { recipe_id: string | null }) | undefined;
  /** null = merkedata lastes fortsatt. */
  labeling: LabelingStatus | null;
};

export type ColDef = ColumnOption & {
  headerClassName?: string;
  cellClassName?: string;
  render: (p: ProductRow, ctx: RowCtx) => ReactNode;
};

export const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-success/15 text-success border-success/30",
  draft: "bg-muted text-muted-foreground border-border",
  paused: "bg-warning/15 text-warning border-warning/30",
  discontinued: "bg-destructive/10 text-destructive border-destructive/30",
};

const LABEL_MODE_LABEL: Record<string, string> = Object.fromEntries(LABEL_MODE_OPTIONS.map((o) => [o.value, o.label]));

export function CalcBadge({ readiness, costStale }: { readiness: RowCtx["readiness"]; costStale: boolean }) {
  const status = readinessStatusLabel(readiness);
  const chips = readinessChips(readiness);
  const cls =
    status === "A" ? "border-success/40 bg-success/10 text-success"
      : status === "B" ? "border-warning/40 bg-warning/10 text-warning"
        : status === "C" ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "text-muted-foreground";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cls} tabIndex={0} aria-label={`Kalkyle ${status}`}>{status}</Badge>
      </TooltipTrigger>
      <TooltipContent>
        {chips.length > 0 ? (
          <ul className="space-y-0.5">{chips.map((c) => <li key={c.key}>{c.label}</li>)}</ul>
        ) : (
          "Kalkylen er komplett"
        )}
        {costStale ? <div className="mt-1">Kostbufferen må regnes på nytt</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Kolonnene i varelisten. Navnet er en ekte lenke til varen. */
export function buildProductColumns({
  hrefFor, renderBoolCell,
}: {
  hrefFor: (id: string) => string;
  renderBoolCell: (p: ProductRow, field: BulkEditableField) => ReactNode;
}): ColDef[] {
  return [
    { key: "number", label: "Nr", fixed: true, headerClassName: "w-16", cellClassName: "text-muted-foreground tabular-nums", render: (p) => p.display_number },
    {
      key: "image", label: "Bilde", cellClassName: "w-12", headerClassName: "w-12",
      render: (p) =>
        p.image_url ? (
          <img src={thumbUrl(p.image_url, 32)} onError={onThumbError(p.image_url)} alt="" width={32} height={32} loading="lazy" decoding="async" className="h-8 w-8 rounded object-cover" />
        ) : (
          <div role="img" aria-label="Mangler bilde" title="Mangler bilde" className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-warning/60 bg-warning/10 text-warning">
            <ImageOff className="h-4 w-4" aria-hidden="true" />
          </div>
        ),
    },
    {
      key: "name", label: "Navn", fixed: true, cellClassName: "min-w-[14rem]",
      render: (p) => (
        <div className={p.variant_of_product_id ? "pl-5 italic" : "font-medium"}>
          <span className="inline-flex items-center gap-1.5">
            <Link
              to={hrefFor(p.id)}
              data-focus-id={p.id}
              className="text-foreground underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.display_name}
            </Link>
            {p.label_mode && p.label_mode !== "none" && (
              <Tooltip>
                <TooltipTrigger asChild><Tag className="h-3.5 w-3.5 shrink-0 text-app" aria-label="Etikett aktivert" /></TooltipTrigger>
                <TooltipContent>Etikett aktivert</TooltipContent>
              </Tooltip>
            )}
            {p.is_cake_component && (
              <Tooltip>
                <TooltipTrigger asChild><Cake className="h-3.5 w-3.5 shrink-0 text-app" aria-label="Kakebygger-byggekloss" /></TooltipTrigger>
                <TooltipContent>Kakebygger-byggekloss{p.cake_role ? `: ${CAKE_ROLE_LABEL[p.cake_role]}` : ""}</TooltipContent>
              </Tooltip>
            )}
          </span>
          {p.variant_label && <span className="ml-2 text-xs text-muted-foreground">({p.variant_label})</span>}
        </div>
      ),
    },
    { key: "code", label: "Varekode", cellClassName: "text-muted-foreground tabular-nums", render: (p) => p.code || "—" },
    { key: "variant_of", label: "Variant av", cellClassName: "text-muted-foreground", render: (_p, ctx) => ctx.parent?.display_name ?? "—" },
    { key: "category", label: "Kategori", render: (p) => p.product_category },
    { key: "main_category", label: "Hovedvaregruppe", render: (p) => <CodedName value={p.main_category} /> },
    { key: "sub_category", label: "Undervaregruppe", render: (p) => <CodedName value={p.sub_category} /> },
    { key: "unit", label: "Salgsenhet", render: (p) => p.unit_of_sale },
    {
      key: "price", label: "Pris", headerClassName: "text-right", cellClassName: "text-right tabular-nums",
      render: (_p, ctx) => (ctx.price !== undefined ? `${formatKr(ctx.price)} kr` : <span className="text-muted-foreground">{ctx.priceLoading ? "Laster …" : "—"}</span>),
    },
    { key: "calc", label: "Kalkyle", render: (_p, ctx) => <CalcBadge readiness={ctx.readiness} costStale={!!ctx.costCache?.is_stale} /> },
    { key: "mva", label: "MVA", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-muted-foreground", render: (p) => (p.mva_rate != null ? `${p.mva_rate}%` : "—") },
    { key: "pieces_per_tray", label: "Antall pr brett", headerClassName: "text-right", cellClassName: "text-right tabular-nums text-muted-foreground", render: (p) => p.pieces_per_tray ?? "—" },
    { key: "in_web_shop", label: "I nettbutikken", headerClassName: "text-center", cellClassName: "text-center", render: (p) => renderBoolCell(p, "in_web_shop") },
    { key: "in_pos", label: "I kasse", headerClassName: "text-center", cellClassName: "text-center", render: (p) => renderBoolCell(p, "in_pos") },
    { key: "label_mode", label: "Etikett", cellClassName: "text-muted-foreground", render: (p) => (p.label_mode ? LABEL_MODE_LABEL[p.label_mode] ?? p.label_mode : "—") },
    { key: "cake_role", label: "Kakebygger", cellClassName: "text-muted-foreground", render: (p) => (p.cake_role ? CAKE_ROLE_LABEL[p.cake_role] : "—") },
    { key: "labeling", label: "Merking", render: (_p, ctx) => <LabelingBadge status={ctx.labeling} /> },
    {
      key: "status", label: "Status", fixed: true,
      render: (p) => <Badge variant="outline" className={STATUS_BADGE[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Badge>,
    },
  ];
}

function CodedName({ value }: { value: { code: string; display_name: string } | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <span className="mr-1.5 font-mono text-xs text-muted-foreground">{value.code}</span>
      {value.display_name}
    </span>
  );
}
