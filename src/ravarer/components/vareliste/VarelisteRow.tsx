import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Minus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";
import { isColumnVisible } from "@/ravarer/lib/varelisteColumns";

export type InlineField = "cost" | "agreed" | "category";

export interface VarelisteRowProps {
  item: RawMaterialListItem;
  hiddenColumns: readonly string[];
  selected: boolean;
  focused: boolean;
  canWrite: boolean;
  tolerance: number;
  editing: InlineField | null;
  onToggleSelect: (id: string) => void;
  onStartEdit: (id: string, field: InlineField) => void;
  onCancelEdit: () => void;
  onCommitPrice: (item: RawMaterialListItem, field: "cost" | "agreed", value: number, reason: string) => void;
  onCommitCategory: (item: RawMaterialListItem, value: string) => void;
  onFocusRow: (id: string) => void;
  /** URL-parametrene fra listen, slik at detaljen kan gå videre/tilbake i samme rekkefølge. */
  listSearch?: string;
}

function StatusChips({ item }: { item: RawMaterialListItem }) {
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

function PackageCell({ item }: { item: RawMaterialListItem }) {
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

function PriceEditor({
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

function CategoryEditor({
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

function DeviationCell({ item, tolerance }: { item: RawMaterialListItem; tolerance: number }) {
  if (item.deviation == null) return <span className="text-muted-foreground">—</span>;
  const over = Math.abs(item.deviation) > tolerance;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs tabular-nums",
        over ? "bg-destructive/10 text-destructive" : "text-muted-foreground",
      )}
    >
      {item.deviation > 0 ? "+" : ""}
      {formatNumber(item.deviation, 1)} %
    </span>
  );
}

function RowInner({
  item,
  hiddenColumns,
  selected,
  focused,
  canWrite,
  tolerance,
  editing,
  categoryOptions,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
  onCommitPrice,
  onCommitCategory,
  onFocusRow,
  listSearch = "",
}: VarelisteRowProps & { categoryOptions: readonly string[] }) {
  const show = (id: string) => isColumnVisible(id, hiddenColumns);
  const cell = "px-3 py-2 align-middle";

  return (
    <tr
      className={cn(
        "border-t border-border/60 odd:bg-muted/20 hover:bg-muted/50",
        focused && "ring-1 ring-inset ring-primary/50",
      )}
      onMouseDown={() => onFocusRow(item.id)}
    >
      <td className={cn(cell, "w-9")} onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(item.id)}
          aria-label={`Velg ${item.name}`}
        />
      </td>

      {show("sku") && (
        <td className={cn(cell, "font-mono text-xs text-muted-foreground")}>
          <Link to={`/ravarer/vareliste/${item.id}${listSearch ? `?${listSearch}` : ""}`} className="hover:underline">
            {item.sku}
          </Link>
        </td>
      )}

      <td className={cell}>
        <Link
          to={`/ravarer/vareliste/${item.id}${listSearch ? `?${listSearch}` : ""}`}
          className="block font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.name}
        </Link>
        {item.declarationName && (
          <span className="text-xs text-muted-foreground">{item.declarationName}</span>
        )}
        {item.matchedAlias && (
          <Badge variant="outline" className="ml-1 text-[11px] font-normal">
            lev.nr {item.matchedAlias}
          </Badge>
        )}
      </td>

      {show("category") && (
        <td className={cell}>
          {editing === "category" ? (
            <CategoryEditor
              initial={item.categories[0] ?? categoryOptions[0] ?? ""}
              options={categoryOptions}
              onCommit={(v) => onCommitCategory(item, v)}
              onCancel={onCancelEdit}
            />
          ) : (
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => onStartEdit(item.id, "category")}
              className="text-left text-muted-foreground hover:underline disabled:cursor-default disabled:no-underline"
            >
              {item.categories.length === 0
                ? "—"
                : item.categories.length === 1
                  ? item.categories[0]
                  : `${item.categories[0]} +${item.categories.length - 1}`}
            </button>
          )}
        </td>
      )}

      {show("supplier") && (
        <td className={cn(cell, "text-muted-foreground")}>
          {item.supplierName ?? "—"}
          {item.supplierSku && (
            <span className="ml-1 text-[11px] text-muted-foreground/80">({item.supplierSku})</span>
          )}
        </td>
      )}

      {show("cost") && (
        <td className={cn(cell, "text-right tabular-nums")}>
          {editing === "cost" ? (
            <PriceEditor
              initial={item.costPrice}
              withReason
              onCommit={(v, reason) => onCommitPrice(item, "cost", v, reason)}
              onCancel={onCancelEdit}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => onStartEdit(item.id, "cost")}
                  className="tabular-nums hover:underline disabled:cursor-default disabled:no-underline"
                >
                  {formatNok(item.costPrice)}{" "}
                  <span className="text-xs text-muted-foreground">/ {item.baseUnit}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {item.costSource ? `Kilde: ${item.costSource}. ` : ""}
                {item.costUpdatedAt ? `Oppdatert ${formatDate(item.costUpdatedAt)}` : "Ingen dato"}
              </TooltipContent>
            </Tooltip>
          )}
        </td>
      )}

      {show("agreed") && (
        <td className={cn(cell, "text-right tabular-nums")}>
          {editing === "agreed" ? (
            <PriceEditor
              initial={item.agreedPrice}
              withReason={false}
              onCommit={(v) => onCommitPrice(item, "agreed", v, "")}
              onCancel={onCancelEdit}
            />
          ) : (
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => onStartEdit(item.id, "agreed")}
              className="tabular-nums hover:underline disabled:cursor-default disabled:no-underline"
            >
              {item.agreedPrice != null ? formatNok(item.agreedPrice) : "—"}
            </button>
          )}
        </td>
      )}

      {show("deviation") && (
        <td className={cn(cell, "text-right")}>
          <DeviationCell item={item} tolerance={tolerance} />
        </td>
      )}

      {show("package") && <td className={cn(cell, "text-xs")}><PackageCell item={item} /></td>}

      {show("volume_12m") && (
        <td className={cn(cell, "text-right tabular-nums")}>
          {item.volume12m > 0 ? (
            <>
              {formatNumber(item.volume12m, 0)}{" "}
              <span className="text-xs text-muted-foreground">{item.baseUnit}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}

      {show("last_invoice") && (
        <td className={cn(cell, "text-muted-foreground")}>{formatDate(item.lastInvoiceDate)}</td>
      )}

      {show("status") && (
        <td className={cell}>
          <StatusChips item={item} />
        </td>
      )}

      {show("active") && (
        <td className={cell}>
          <ItemTypeBadge itemType={item.itemType} className="mr-1" />
          {item.isActive ? (
            <Badge className="border-success/30 bg-success/15 text-success">Aktiv</Badge>
          ) : (
            <Badge variant="outline">Inaktiv</Badge>
          )}
        </td>
      )}
    </tr>
  );
}

export const VarelisteRow = memo(RowInner);
