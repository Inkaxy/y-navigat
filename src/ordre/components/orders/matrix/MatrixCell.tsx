import { memo, useCallback, type KeyboardEvent, type FocusEvent } from "react";
import { Input } from "@/components/ui/input";
import { StickyNote, Layers, MoreHorizontal, ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { focusMatrixCell, focusMatrixCellByOffset } from "@/ordre/lib/matrixKeyboard";

export type MatrixCellProps = {
  cellKey: string;
  date: string;
  tourId: string;
  productId: string;
  /** Rutenett-koordinater for piltast-navigasjon. */
  rowIndex: number;
  colIndex: number;
  value: string;
  dirty: boolean;
  /** Cellen viser et fastordre-tall som ennå ikke er materialisert. */
  fromFixed: boolean;
  ghostQty: number;
  paused: boolean;
  pauseReason: string | null;
  toneKind: string | null;
  toneVar: string | null;
  fallback: boolean;
  hasMerknad: boolean;
  hasData: boolean;
  orderCount: number;
  onChange: (key: string, value: string) => void;
  onPausedClick: () => void;
  /** Esc — tilbakestill cellen til lagret verdi. */
  onReset: (key: string) => void;
  /** Ctrl/Cmd+S — lagre matrisen. */
  onSave: () => void;
  onOpenMerknad: (date: string, tourId: string, productId: string) => void;
  onCopyNextDay: (date: string, tourId: string, productId: string) => void;
};

function MatrixCellImpl({
  cellKey,
  date,
  tourId,
  productId,
  rowIndex,
  colIndex,
  value,
  dirty,
  fromFixed,
  ghostQty,
  paused,
  pauseReason,
  toneKind,
  toneVar,
  fallback,
  hasMerknad,
  hasData,
  orderCount,
  onChange,
  onPausedClick,
  onReset,
  onSave,
  onOpenMerknad,
  onCopyNextDay,
}: MatrixCellProps) {
  const effectiveQty = value ? Number(value.replace(",", ".") || 0) : 0;
  /**
   * Flere ordre i samme celle kan ikke redigeres her: lagringen oppdaterer
   * bare ÉN ordre, så en endring ville flyttet antall mellom ordrene.
   */
  const multiOrder = orderCount > 1;
  const locked = paused || multiOrder;
  const ghostOverridden = !!ghostQty && !fromFixed && !!value && effectiveQty !== ghostQty;

  const handleFocus = useCallback((e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          focusMatrixCell(el, rowIndex - 1, colIndex);
          break;
        case "ArrowDown":
          e.preventDefault();
          focusMatrixCell(el, rowIndex + 1, colIndex);
          break;
        case "ArrowLeft":
          e.preventDefault();
          focusMatrixCell(el, rowIndex, colIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          focusMatrixCell(el, rowIndex, colIndex + 1);
          break;
        case "Enter":
          e.preventDefault();
          focusMatrixCell(el, rowIndex + (e.shiftKey ? -1 : 1), colIndex);
          break;
        case "Tab":
          if (focusMatrixCellByOffset(el, e.shiftKey ? -1 : 1)) e.preventDefault();
          break;
        case "Escape":
          e.preventDefault();
          onReset(cellKey);
          break;
        default:
          break;
      }
    },
    [cellKey, colIndex, onReset, onSave, rowIndex],
  );

  return (
    <td
      data-order-kind={toneKind ?? undefined}
      data-from-fixed={fromFixed ? "true" : undefined}
      className={cn(
        "group relative border-b border-r border-border p-0",
        paused && "bg-sky-50 dark:bg-sky-950/30",
        multiOrder && !paused && "bg-muted/60",
        dirty && "bg-warning/25",
        fallback && "outline outline-2 -outline-offset-2 outline-destructive/70",
      )}
      style={
        !paused && !dirty && toneVar
          ? { backgroundColor: `hsl(var(${toneVar}) / 0.07)` }
          : undefined
      }
      title={
        multiOrder
          ? "Flere ordre i cellen — rediger i ordrevisningen"
          : fallback
          ? "Pris ikke funnet — mangler prisliste-rad eller spesialpris"
          : fromFixed
            ? `Fra fastordre: ${ghostQty} stk — skriv over for å endre`
            : ghostQty
              ? ghostOverridden
                ? `Fastordre: ${ghostQty} stk — overstyrt til ${effectiveQty}`
                : `Fastordre: ${ghostQty} stk`
              : paused
                ? pauseReason
                  ? `Leveransepause: ${pauseReason}`
                  : "Leveransepause"
                : undefined
      }
    >
      <Input
        type="text"
        inputMode="decimal"
        data-cell={cellKey}
        data-cell-row={rowIndex}
        data-cell-col={colIndex}
        value={value}
        readOnly={locked}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          if (locked) return;
          onChange(cellKey, e.target.value);
        }}
        onMouseDown={(e) => {
          if (paused) {
            e.preventDefault();
            onPausedClick();
          }
        }}
        aria-readonly={locked || undefined}
        className={cn(
          "h-9 w-16 rounded-none border-0 bg-transparent px-1 text-center tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
          value && "text-base font-semibold text-foreground",
          fromFixed && "italic text-muted-foreground",
          dirty && "font-bold not-italic text-warning",
          locked && "cursor-not-allowed",
        )}
      />
      {hasMerknad && (
        <span
          className="pointer-events-none absolute right-0.5 top-0.5 text-primary"
          aria-label="Har merknad"
          title="Har merknad"
        >
          <StickyNote className="h-2.5 w-2.5" />
        </span>
      )}
      {orderCount > 1 && (
        <span
          className="pointer-events-none absolute left-0.5 top-0.5 text-muted-foreground"
          aria-label={`${orderCount} ordre`}
          title="Flere ordre i cellen — rediger i ordrevisningen"
        >
          <Layers className="h-2.5 w-2.5" />
        </span>
      )}
      {hasData && !locked && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Celle-handlinger"
              className="absolute bottom-0 right-0 hidden h-4 w-4 items-center justify-center rounded-tl-sm bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex data-[state=open]:flex"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onOpenMerknad(date, tourId, productId)}>
              <StickyNote className="h-4 w-4 mr-2" />
              Merknad
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onCopyNextDay(date, tourId, productId)}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Kopier til neste dag
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </td>
  );
}

export const MatrixCell = memo(MatrixCellImpl);
