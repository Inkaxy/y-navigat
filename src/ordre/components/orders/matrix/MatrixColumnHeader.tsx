import { memo } from "react";
import { Copy, Trash2, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatrixTour } from "@/ordre/hooks/useMatrix";
import { OrderKindBadge } from "@/ordre/components/orders/OrderKindBadge";
import { LifecycleBadge } from "@/ordre/components/orders/LifecycleBadge";

/** Alt en kolonneheader trenger, som ferdig utregnede, stabile verdier. */
export type MatrixColumnHeaderData = {
  date: string;
  tour: MatrixTour;
  dayLabel: string;
  paused: boolean;
  pauseReason: string | null;
  hasComment: boolean;
  commentText: string | null;
  colHasData: boolean;
  toneKind: string | null;
  toneVar: string | null;
  deliveryNote: boolean;
  deliveryNoteNumber: string | null;
  metaKind: string | null;
  metaLifecycle: string | null;
  metaNoteNumber: string | null;
};

export type MatrixColumnHeaderProps = MatrixColumnHeaderData & {
  canEdit: boolean;
  onOpenTourOrder: (date: string, tour: MatrixTour) => void;
  onColCopy: (date: string, tour: MatrixTour) => void;
  onColDelete: (date: string, tour: MatrixTour) => void;
  onColPackingNote: (date: string, tour: MatrixTour) => void;
};

function MatrixColumnHeaderImpl({
  date,
  tour,
  dayLabel,
  paused,
  pauseReason,
  hasComment,
  commentText,
  colHasData,
  toneKind,
  toneVar,
  deliveryNote,
  deliveryNoteNumber,
  metaKind,
  metaLifecycle,
  metaNoteNumber,
  canEdit,
  onOpenTourOrder,
  onColCopy,
  onColDelete,
  onColPackingNote,
}: MatrixColumnHeaderProps) {
  return (
    <th
      data-order-kind={toneKind ?? undefined}
      className={cn(
        "border-b border-r border-border px-1 py-1 text-center text-[11px] font-medium text-muted-foreground",
        paused ? "bg-sky-100 dark:bg-sky-950/40" : "bg-card/80",
      )}
      style={!paused && toneVar ? { backgroundColor: `hsl(var(${toneVar}) / 0.16)` } : undefined}
      title={`${tour.display_name} (${tour.time_from.slice(0, 5)}–${tour.time_to.slice(0, 5)})${
        pauseReason ? ` · Pause: ${pauseReason}` : paused ? " · Pause" : ""
      }${hasComment ? `\nKommentar: ${commentText ?? ""}` : ""}`}
    >
      {deliveryNote && (
        <div
          className="-mx-1 -mt-1 mb-1 truncate px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: "hsl(var(--lifecycle-delivery-note))" }}
        >
          Pakkseddel{deliveryNoteNumber ? ` ${deliveryNoteNumber}` : ""}
        </div>
      )}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onOpenTourOrder(date, tour)}
        className="mx-auto block rounded px-1.5 py-0.5 text-[12px] font-semibold text-foreground hover:bg-primary/10 hover:text-primary"
        title={colHasData ? "Åpne ordre for denne turen" : "Fastordre — skriv i cellene og lagre"}
      >
        {dayLabel} ({tour.tour_number})
        {hasComment && <span className="ml-1 text-primary">•</span>}
      </button>

      {(metaKind || metaLifecycle) && (
        <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1">
          {metaKind ? <OrderKindBadge kind={metaKind as never} size="sm" /> : null}
          {metaLifecycle ? (
            <LifecycleBadge
              lifecycle={metaLifecycle as never}
              deliveryNoteNumber={metaNoteNumber}
              size="sm"
            />
          ) : null}
        </div>
      )}
      {paused && (
        <div className="mt-0.5 inline-block rounded-sm bg-sky-200/80 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-900 dark:bg-sky-800/60 dark:text-sky-100">
          Pause
        </div>
      )}
      <div className="mt-1 flex items-center justify-center gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          disabled={!canEdit || !colHasData}
          onClick={() => onColCopy(date, tour)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          title="Kopier kolonne"
          aria-label="Kopier kolonne"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={!canEdit || !colHasData}
          onClick={() => onColDelete(date, tour)}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
          title="Slett kolonne"
          aria-label="Slett kolonne"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={!colHasData}
          onClick={() => onColPackingNote(date, tour)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          title="Lag pakkseddel"
          aria-label="Lag pakkseddel"
        >
          <PackageCheck className="h-4 w-4" />
        </button>
      </div>
    </th>
  );
}

export const MatrixColumnHeader = memo(MatrixColumnHeaderImpl);
