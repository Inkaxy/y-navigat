import { memo } from "react";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";
import type { NoTourEntry } from "@/ordre/lib/matrixEdits";
import { ckey } from "@/ordre/lib/matrixEdits";
import { formatNOK } from "@/ordre/lib/format";
import { formatKrNetto } from "@/ordre/lib/dateRanges";
import { MatrixCell } from "./MatrixCell";

/** Kolonnene som faktisk rendres i rutenettet. */
export type RenderCol =
  | { kind: "tour"; date: string; tour: MatrixTour }
  | { kind: "notour"; date: string };

/** Kolonneavhengig celleinfo — uavhengig av hva brukeren har skrevet. */
export type CellColInfo = {
  paused: boolean;
  pauseReason: string | null;
  toneKind: string | null;
  toneVar: string | null;
};

export const FIRST_COL_WIDTH =
  "w-[240px] min-w-[240px] lg:w-[280px] lg:min-w-[280px] xl:w-[320px] xl:min-w-[320px]";

export const EMPTY_ROW_EDITS: Record<string, string> = Object.freeze({});

export type MatrixProductRowProps = {
  product: MatrixProduct;
  isAdded: boolean;
  rowIndex: number;
  renderCols: RenderCol[];
  /** Kun de ulagrede endringene som gjelder denne produktraden. */
  editsForRow: Record<string, string>;
  /** Lagret/fastordre-verdi uten hensyn til ulagrede endringer. */
  getBaseValue: (key: string) => string;
  isBaseGhost: (key: string) => boolean;
  ghostQty: (key: string) => number;
  existingQty: (key: string) => number;
  isFallback: (key: string) => boolean;
  hasMerknad: (key: string) => boolean;
  orderCount: (key: string) => number;
  colInfo: (date: string, tourId: string) => CellColInfo;
  noTourByDate: Map<string, Map<string, NoTourEntry>>;
  rowQtySum: number;
  /** Antall uten tur — holdes utenfor ukesummen, som «Sum kr» også gjør. */
  rowNoTourQty: number;
  rowTotal: number;
  canEdit: boolean;
  onChange: (key: string, value: string) => void;
  onReset: (key: string) => void;
  onSave: () => void;
  onPausedClick: () => void;
  onOpenMerknad: (date: string, tourId: string, productId: string) => void;
  onCopyNextDay: (date: string, tourId: string, productId: string) => void;
  onOpenWeekEditor: (product: MatrixProduct) => void;
  onOpenProductInfo: (product: MatrixProduct) => void;
  onMoveToTour: (entry: NoTourEntry) => void;
};

function MatrixProductRowImpl({
  product: p,
  isAdded,
  rowIndex,
  renderCols,
  editsForRow,
  getBaseValue,
  isBaseGhost,
  ghostQty,
  existingQty,
  isFallback,
  hasMerknad,
  orderCount,
  colInfo,
  noTourByDate,
  rowQtySum,
  rowNoTourQty,
  rowTotal,
  canEdit,
  onChange,
  onReset,
  onSave,
  onPausedClick,
  onOpenMerknad,
  onCopyNextDay,
  onOpenWeekEditor,
  onOpenProductInfo,
  onMoveToTour,
}: MatrixProductRowProps) {
  let colIndex = -1;
  return (
    <tr className="hover:bg-muted/30">
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 border-b border-r border-border px-3 py-1.5 text-left font-normal",
          FIRST_COL_WIDTH,
          isAdded ? "bg-accent/30" : "bg-card",
        )}
      >
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onOpenProductInfo(p)}
            className="inline-flex w-9 shrink-0 items-center justify-center self-stretch rounded-md border border-brand-bronze/40 bg-brand-bronze/10 text-brand-bronze shadow-sm transition-colors hover:border-brand-bronze hover:bg-brand-bronze hover:text-brand-ink"
            title="Produkthåndbok"
            aria-label={`Produkthåndbok for ${p.display_name}`}
          >
            <BookOpen className="h-5 w-5" strokeWidth={2.25} />
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onOpenWeekEditor(p)}
              title="Klikk for å redigere hele uken for denne varen"
              className="flex w-full items-center gap-1.5 truncate text-left font-medium hover:text-primary"
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {p.display_number}
              </span>
              <span className="truncate">{p.display_name}</span>
              {isAdded && <Badge variant="outline" className="ml-1 text-[10px]">Ny</Badge>}
            </button>
            <div className="text-[11px] text-muted-foreground">
              {p.sales_unit} ·{" "}
              {p.unit_price == null ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground/70">—</span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      Ingen pris for denne kunden på valgt dato. Pris må settes i Varer-appen før
                      ordren kan lagres.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                formatNOK(p.unit_price)
              )}
            </div>
          </div>
        </div>
      </th>

      {renderCols.map((rc) => {
        if (rc.kind === "notour") {
          const entry = noTourByDate.get(rc.date)?.get(p.id);
          return (
            <td
              key={`${rc.date}-notour-${p.id}`}
              className="border-b border-r border-border bg-muted/30 px-1 py-1.5 text-center"
              title={
                entry
                  ? `Uten tur${entry.orderNumbers.length ? ` · ${entry.orderNumbers.join(", ")}` : ""}`
                  : undefined
              }
            >
              {entry ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-base font-semibold tabular-nums">{entry.quantity}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onMoveToTour(entry)}
                    disabled={!canEdit}
                    className="rounded px-1 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
                  >
                    Flytt til tur
                  </button>
                </div>
              ) : null}
            </td>
          );
        }

        colIndex += 1;
        const key = ckey(rc.date, rc.tour.id, p.id);
        const raw = editsForRow[key];
        const edited = raw !== undefined;
        const value = edited ? raw : getBaseValue(key);
        const dirty = edited && Number(raw || 0) !== existingQty(key);
        const info = colInfo(rc.date, rc.tour.id);
        const merknad = hasMerknad(key);
        const qty = value ? Number(value.replace(",", ".")) || 0 : 0;

        return (
          <MatrixCell
            key={key}
            cellKey={key}
            date={rc.date}
            tourId={rc.tour.id}
            productId={p.id}
            rowIndex={rowIndex}
            colIndex={colIndex}
            value={value}
            dirty={dirty}
            fromFixed={!edited && isBaseGhost(key)}
            ghostQty={info.paused ? 0 : ghostQty(key)}
            paused={info.paused}
            pauseReason={info.pauseReason}
            toneKind={info.toneKind}
            toneVar={info.toneVar}
            fallback={isFallback(key)}
            hasMerknad={merknad}
            hasData={qty > 0 || merknad}
            orderCount={orderCount(key)}
            onChange={onChange}
            onPausedClick={onPausedClick}
            onReset={onReset}
            onSave={onSave}
            onOpenMerknad={onOpenMerknad}
            onCopyNextDay={onCopyNextDay}
          />
        );
      })}

      <td className="border-b border-r border-border/60 bg-card px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
        <div>{rowQtySum || ""}</div>
        {rowNoTourQty > 0 && (
          <div className="text-[10px] text-muted-foreground/80" title="Uten tur — ikke med i ukesummen eller Sum kr">
            +{rowNoTourQty} uten tur
          </div>
        )}
      </td>
      <td className="border-b border-r border-border bg-card px-3 py-1.5 text-right font-bold tabular-nums">
        {formatKrNetto(rowTotal)}
      </td>
    </tr>
  );
}

export const MatrixProductRow = memo(MatrixProductRowImpl);
