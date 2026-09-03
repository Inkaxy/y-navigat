import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLastUpdated, formatNorwegianToday } from "@/ordre/lib/deskHeaderFormat";


export type OrderDeskHeaderProps = {
  /** Dato som skal vises — normalt «i dag» i Oslo-tid. */
  date: Date;
  /** `dataUpdatedAt` fra arbeidsbordet (ms siden epoch, 0 = aldri hentet). */
  dataUpdatedAt: number;
  isFetching?: boolean;
  onRefresh: () => void;
};

/**
 * Kompakt statuslinje øverst på arbeidsbordet.
 *
 * Ligger under AppBanner (som beholder «Ny ordre» som primærhandling) og svarer
 * på tre spørsmål med én gang: hvor er jeg, hvilken dag er det, og hvor ferske
 * er tallene på skjermen.
 */
export function OrderDeskHeader({
  date,
  dataUpdatedAt,
  isFetching,
  onRefresh,
}: OrderDeskHeaderProps) {
  return (
    <section
      aria-labelledby="order-desk-now"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <div className="min-w-0">
        <h2 id="order-desk-now" className="text-title font-semibold leading-tight text-foreground">
          Ordrekontoret nå
        </h2>
        <p className="mt-0.5 text-caption text-muted-foreground">
          <span>{formatNorwegianToday(date)}</span>
          <span aria-hidden="true"> · </span>
          <span aria-live="polite">{formatLastUpdated(dataUpdatedAt)}</span>
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 gap-2"
        onClick={onRefresh}
        disabled={isFetching}
      >
        <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden="true" />
        {isFetching ? "Oppdaterer …" : "Oppdater"}
      </Button>
    </section>
  );
}
