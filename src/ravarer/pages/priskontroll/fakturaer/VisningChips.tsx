import { cn } from "@/lib/utils";
import type { InvoiceCounts } from "@/ravarer/lib/workRpcTypes";
import { FAKTURA_VISNINGER, VISNING_LABEL, type AvstemtModus, type FakturaVisning } from "./visning";

type Counts = { trenger?: number; klar?: number; inv: InvoiceCounts | null; alle: number | null };

type Props = {
  visning: FakturaVisning;
  modus: AvstemtModus | null;
  counts: Counts;
  onChange: (v: FakturaVisning, m: AvstemtModus | null) => void;
};

/** Tall per chip: serverens sammendrag der det finnes, ellers listesvaret. */
export function chipCount(v: FakturaVisning, c: Counts): number | null {
  if (v === "trenger") return c.trenger ?? null;
  if (v === "klar") return c.inv?.ready_to_reconcile ?? c.klar ?? null;
  if (v === "avstemt") return c.inv?.reconciled_total ?? null;
  return c.alle;
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
        active ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-ink-secondary hover:text-foreground",
      )}
    >
      {label}
      {count != null && <span className="tabular-nums text-ink-secondary">{count}</span>}
    </button>
  );
}

export function VisningChips({ visning, modus, counts, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Hurtigfilter">
      {FAKTURA_VISNINGER.map((v) => (
        <Chip key={v} active={visning === v} label={VISNING_LABEL[v]} count={chipCount(v, counts)} onClick={() => onChange(v, null)} />
      ))}
      {visning === "avstemt" && (
        <span className="ml-1 flex gap-1.5 border-l border-border pl-2.5">
          <Chip active={modus === "auto"} label="Automatisk" count={counts.inv?.reconciled_auto ?? null} onClick={() => onChange("avstemt", modus === "auto" ? null : "auto")} />
          <Chip
            active={modus === "manuell"}
            label="Manuelt"
            count={counts.inv ? counts.inv.reconciled_total - counts.inv.reconciled_auto : null}
            onClick={() => onChange("avstemt", modus === "manuell" ? null : "manuell")}
          />
        </span>
      )}
    </div>
  );
}
