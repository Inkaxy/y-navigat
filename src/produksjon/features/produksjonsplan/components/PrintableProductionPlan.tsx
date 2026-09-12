import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ProductionPlanTable } from "./ProductionPlanTable";
import { CorrectionPlanTable } from "./CorrectionPlanTable";
import type { PrintAttempt } from "../lib/printAttempt";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";
import type { SnapshotItem } from "../hooks/useProductionPlanSnapshots";
import type { PrintOrderCounts, PrintViewPrefs } from "../lib/printAttempt";

export interface PrintableProductionPlanProps {
  rows: ProductionPlanRow[];
  criteria: ProduksjonsplanCriteria;
  dateLabel: string;
  printedAt: string;
  dateStr: string;
  prefs: PrintViewPrefs;
  counts: PrintOrderCounts | null;
  prevItems: Map<string, SnapshotItem> | null;
  prevTakenAt: string | null;
  correction: boolean;
  zebra: boolean;
}

/**
 * Selve utskriftsarket. Får ALT som props slik at et fryst utskriftsforsøk kan
 * rendres uavhengig av hva den levende planen gjør etterpå (ny dato, feilet
 * bakgrunnsoppdatering). Ingen verdi leses «nå» inne i komponenten.
 */
export function PrintableProductionPlan(props: PrintableProductionPlanProps) {
  const correctionLast = props.correction && !!props.prevItems;
  const pages: Array<{ kind: "normal" | "correction"; copyIdx: number }> = [
    { kind: "normal", copyIdx: 0 },
  ];
  if (correctionLast) pages.push({ kind: "correction", copyIdx: 1 });

  return (
    <div
      className={cn("hidden print:block", props.zebra && "print-zebra-rows")}
      data-testid="print-area"
      data-print-date={props.dateStr}
    >
      {pages.map((p) => (
        <div key={p.copyIdx} className="print-page">
          <div className="flex justify-between items-baseline mb-2">
            <h1 className="text-base font-bold uppercase">
              {p.kind === "correction" ? "Korreksjonsliste for: " : "Produksjonsliste for: "}
              {props.dateLabel}
              {p.kind === "correction" && props.prevTakenAt && (
                <span className="ml-2 text-[9pt] font-normal normal-case">
                  – endring siden {format(new Date(props.prevTakenAt), "HH:mm")}
                </span>
              )}
            </h1>
            <span className="text-[9pt]">Skrevet ut: {props.printedAt}</span>
          </div>
          {p.kind === "correction" && props.prevItems ? (
            <CorrectionPlanTable
              rows={props.rows}
              showByMainGroup={props.prefs.showByMainGroup}
              showTraysWithPlus={props.prefs.showTraysWithPlus}
              columns={props.prefs.columns}
              previousItems={props.prevItems}
              criteria={props.criteria}
            />
          ) : (
            <ProductionPlanTable
              rows={props.rows}
              showByMainGroup={props.prefs.showByMainGroup}
              showTraysWithPlus={props.prefs.showTraysWithPlus}
              loading={false}
              columns={props.prefs.columns}
              deliveryDate={props.dateStr}
            />
          )}
          {props.counts && (
            <p className="text-[9pt] mt-2">
              Fra {props.counts.datert} daterte ordre, {props.counts.fast} fastordre
              {props.counts.pakkseddel > 0 ? `, ${props.counts.pakkseddel} pakksedler` : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Praktisk innpakning for et fryst utskriftsforsøk. */
export function FrozenPrintableProductionPlan({ attempt }: { attempt: PrintAttempt }) {
  return (
    <PrintableProductionPlan
      rows={attempt.rows}
      criteria={attempt.criteria}
      dateLabel={attempt.dateLabel}
      printedAt={attempt.printedAt}
      dateStr={attempt.dateStr}
      prefs={attempt.prefs}
      counts={attempt.counts}
      prevItems={attempt.prevItems}
      prevTakenAt={attempt.prevTakenAt}
      correction={attempt.correction}
      zebra={attempt.options.alternateRowGray ?? true}
    />
  );
}
