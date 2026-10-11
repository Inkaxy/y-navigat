import { useEffect, useRef, useState, type ReactNode } from "react";
import { ComparisonCell, CostStatusMark, PriceSourceCell } from "./PriceCells";
import { COST_STATUS_LABEL } from "@/ravarer/lib/listPriceEvidence";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Minus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";
import { LIST_COLUMNS } from "@/ravarer/lib/varelisteColumns";
import { csvValue, priceSourceLabel } from "@/ravarer/lib/varelisteCsv";
import type { Column } from "@/ravarer/ui/DataTable";
import { paths } from "@/ravarer/lib/paths";

export type InlineField = "cost" | "agreed" | "category";

export function StatusChips({ item }: { item: RawMaterialListItem }) {
  const chips: { label: string; ok: boolean }[] = [
    { label: "Dekl.", ok: !!item.declarationName?.trim() },
    { label: "Datablad", ok: item.hasDatasheet },
    { label: "Allergen", ok: item.hasAllergens },
    { label: "Næring", ok: item.hasNutrition },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px]",
            c.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
          title={c.ok ? `${c.label}: registrert` : `${c.label}: mangler`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function PackageCell({ item }: { item: RawMaterialListItem }) {
  if (item.packageState === "confirmed")
    return (
      <span className="inline-flex items-center gap-1 text-success" title="Pakning bekreftet">
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Bekreftet
      </span>
    );
  if (item.packageState === "unconfirmed")
    return (
      <span className="inline-flex items-center gap-1 text-warning" title="Pakning ikke bekreftet">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Ubekreftet
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground" title="Pakning mangler">
      <Minus className="h-3.5 w-3.5" aria-hidden="true" /> Mangler
    </span>
  );
}

export function PriceEditor({
  initial,
  withReason,
  onCommit,
  onCancel,
}: {
  initial: number | null;
  withReason: boolean;
  onCommit: (value: number, reason: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial != null ? String(initial) : "");
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      onCancel();
      return;
    }
    onCommit(parsed, reason.trim());
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-7 w-24 text-right tabular-nums"
        aria-label="Ny pris"
      />
      {withReason && (
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder="Hvorfor?"
          className="h-7 w-28"
          aria-label="Begrunnelse"
        />
      )}
    </div>
  );
}

export function CategoryEditor({
  initial,
  options,
  onCommit,
  onCancel,
}: {
  initial: string;
  options: readonly string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <select
      ref={ref}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => (value === initial ? onCancel() : onCommit(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-7 rounded-md border border-input bg-background px-2 text-sm"
      aria-label="Kategori"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export interface VarelisteCellContext {
  canWrite: boolean;
  categoryOptions: readonly string[];
  toleranceFor: (category?: string | null) => number;
  hardCap: number;
  editing: { id: string; field: InlineField } | null;
  onStartEdit: (id: string, field: InlineField) => void;
  onCancelEdit: () => void;
  onCommitPrice: (item: RawMaterialListItem, field: "cost" | "agreed", value: number, reason: string) => void;
  onCommitCategory: (item: RawMaterialListItem, value: string) => void;
  /** URL-parametrene fra listen, slik at detaljen kan gå videre/tilbake i samme rekkefølge. */
  listSearch: string;
}

const editingField = (ctx: VarelisteCellContext, id: string): InlineField | null => (ctx.editing?.id === id ? ctx.editing.field : null);

/** Cellen for hver kolonne-ID. Rekkefølgen styres ALLTID av `LIST_COLUMNS`, aldri av denne tabellen. */
function cellFor(id: string, ctx: VarelisteCellContext): (item: RawMaterialListItem) => ReactNode {
  const detailUrl = (item: RawMaterialListItem) => `${paths.raavare(item.id)}${ctx.listSearch ? `?${ctx.listSearch}` : ""}`;
  switch (id) {
    case "sku":
      return (item) => <Link to={detailUrl(item)} className="whitespace-nowrap font-mono text-xs text-muted-foreground hover:underline">{item.sku}</Link>;
    case "name":
      return (item) => (
        <div className="min-w-[12rem] max-w-[22rem]">
          {/* Navnet holdes lesbart: én linje med hele navnet i title; deklarasjonsnavn som én linje under. */}
          <Link to={detailUrl(item)} title={item.name} className="block truncate font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.name}</Link>
          {item.declarationName && <span className="block truncate text-xs text-muted-foreground" title={item.declarationName}>{item.declarationName}</span>}
          {item.matchedAlias && <Badge variant="outline" className="text-[11px] font-normal">lev.nr {item.matchedAlias}</Badge>}
        </div>
      );
    case "category":
      return (item) => editingField(ctx, item.id) === "category" ? (
        <CategoryEditor initial={item.categories[0] ?? ctx.categoryOptions[0] ?? ""} options={ctx.categoryOptions} onCommit={(v) => ctx.onCommitCategory(item, v)} onCancel={ctx.onCancelEdit} />
      ) : (
        <button type="button" disabled={!ctx.canWrite} onClick={() => ctx.onStartEdit(item.id, "category")} className="text-left text-muted-foreground hover:underline disabled:cursor-default disabled:no-underline">
          {item.categories.length === 0 ? "—" : item.categories.length === 1 ? item.categories[0] : `${item.categories[0]} +${item.categories.length - 1}`}
        </button>
      );
    case "supplier":
      return (item) => (
        <span className="text-muted-foreground">
          {item.supplierName ?? "—"}
          {item.supplierSku && <span className="ml-1 text-[11px] text-muted-foreground/80">({item.supplierSku})</span>}
        </span>
      );
    case "cost":
      return (item) => editingField(ctx, item.id) === "cost" ? (
        <PriceEditor initial={item.costPrice} withReason onCommit={(v, reason) => ctx.onCommitPrice(item, "cost", v, reason)} onCancel={ctx.onCancelEdit} />
      ) : (
        <span className="inline-flex flex-wrap items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" disabled={!ctx.canWrite} onClick={() => ctx.onStartEdit(item.id, "cost")} className="tabular-nums hover:underline disabled:cursor-default disabled:no-underline">
                {formatNok(item.costPrice)} <span className="text-xs text-muted-foreground">/ {item.baseUnit}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {`Kostpris: ${COST_STATUS_LABEL[item.costStatus]}. `}
              {item.costReason ? `${item.costReason}. ` : ""}
              {item.costSource ? `Kilde: ${priceSourceLabel(item.costSource)}. ` : ""}
              {item.costUpdatedAt ? `Oppdatert ${formatDate(item.costUpdatedAt)}` : "Ingen dato"}
            </TooltipContent>
          </Tooltip>
          <CostStatusMark status={item.costStatus} />
        </span>
      );
    case "agreed":
      return (item) => editingField(ctx, item.id) === "agreed" ? (
        <PriceEditor initial={item.agreedPrice} withReason={false} onCommit={(v) => ctx.onCommitPrice(item, "agreed", v, "")} onCancel={ctx.onCancelEdit} />
      ) : (
        <button type="button" disabled={!ctx.canWrite} onClick={() => ctx.onStartEdit(item.id, "agreed")} className="tabular-nums hover:underline disabled:cursor-default disabled:no-underline">
          {!item.primaryLinkId ? <span className="text-caption text-muted-foreground">Velg primærleverandør først</span> : item.agreedPrice != null ? formatNok(item.agreedPrice) : "—"}
        </button>
      );
    case "deviation":
      return (item) => <ComparisonCell comparison={item.comparison} baseUnit={item.baseUnit} tolerance={ctx.toleranceFor(item.categories[0])} hardCap={ctx.hardCap} />;
    case "package":
      return (item) => <span className="text-xs"><PackageCell item={item} /></span>;
    case "volume_12m":
      return (item) => item.volume12m > 0 ? <>{formatNumber(item.volume12m, 0)} <span className="text-xs text-muted-foreground">{item.baseUnit}</span></> : <span className="text-muted-foreground">—</span>;
    case "last_invoice":
      return (item) => <span className="text-muted-foreground">{formatDate(item.lastInvoiceDate)}</span>;
    case "price_source":
      return (item) => <PriceSourceCell source={item.costSource} updatedAt={item.costUpdatedAt} />;
    case "price_updated":
      return (item) => <span className="text-muted-foreground">{formatDate(item.costUpdatedAt)}</span>;
    case "stock":
      return (item) => item.stockTracking ? (
        <span className={cn(item.minStock != null && item.currentStock < item.minStock && "text-destructive")}>
          {formatNumber(item.currentStock, 0)} <span className="text-xs text-muted-foreground">{item.baseUnit}</span>
        </span>
      ) : <span className="text-muted-foreground" title="Uten lagerstyring">—</span>;
    case "status":
      return (item) => <StatusChips item={item} />;
    case "active":
      return (item) => (
        <>
          <ItemTypeBadge itemType={item.itemType} className="mr-1" />
          {item.isActive ? <Badge className="border-success/30 bg-success/15 text-success">Aktiv</Badge> : <Badge variant="outline">Inaktiv</Badge>}
        </>
      );
    default:
      return () => null;
  }
}

/**
 * Varelistens kolonner for den felles DataTable: ÉN ordnet definisjon (`LIST_COLUMNS`) gir
 * overskrift, celle og CSV. Sortering er styrt av URL-en (11 nøkler), så `sortKey` er bare et flagg.
 */
export function buildVarelisteColumns(ctx: VarelisteCellContext): Column<RawMaterialListItem>[] {
  return LIST_COLUMNS.map((c) => ({
    id: c.id,
    header: c.label,
    cell: cellFor(c.id, ctx),
    csv: (item: RawMaterialListItem) => csvValue(c.id, item),
    sortKey: c.sortKey ? () => null : undefined,
    align: c.numeric ? ("right" as const) : ("left" as const),
    hideable: !c.alwaysVisible,
    alwaysVisible: c.alwaysVisible,
  }));
}
