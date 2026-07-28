import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKr, type GroupDef } from "@/fakturering/lib/groups";

interface Props {
  def: GroupDef;
  customerCount: number;
  orderCount: number;
  sumInclVat: number;
  isEmpty: boolean;
  isInternal: boolean;
  isNonTransfer: boolean;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function GroupCard({
  def, customerCount, orderCount, sumInclVat,
  isEmpty, isInternal, isNonTransfer, selected, disabled, onToggle,
}: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || isEmpty}
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border p-5 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--app-primary))]",
        selected
          ? "border-[hsl(var(--app-primary))] bg-[hsl(var(--app-primary)/0.06)] shadow-sm ring-1 ring-[hsl(var(--app-primary)/0.35)]"
          : "border-line-subtle bg-surface-raised hover:border-[hsl(var(--app-primary)/0.4)]",
        (disabled || isEmpty) && "opacity-60 cursor-not-allowed hover:border-line-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {def.code} · {def.label}
          </div>
          <div className="mt-0.5 font-display text-xl font-semibold text-text-primary">
            {def.label}
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
            selected
              ? "border-[hsl(var(--app-primary))] bg-[hsl(var(--app-primary))] text-white"
              : "border-line-strong bg-surface",
          )}
        >
          {selected && <Check className="h-4 w-4" strokeWidth={3} />}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold tabular-nums text-text-primary">
          {customerCount}
        </span>
        {customerCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {customerCount === 1 ? "kunde" : "kunder"} · {orderCount} {orderCount === 1 ? "ordre" : "ordrer"}
          </span>
        )}
      </div>

      <div className={cn(
        "text-sm font-semibold tabular-nums",
        isEmpty ? "text-muted-foreground" : "text-text-primary",
      )}>
        {isEmpty ? "—" : formatKr(sumInclVat)}
      </div>

      {(isInternal || isNonTransfer) && (
        <div className="flex flex-wrap gap-1.5">
          {isInternal && (
            <span className="rounded-md bg-[hsl(var(--app-primary)/0.14)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--app-primary))]">
              Intern
            </span>
          )}
          {isNonTransfer && (
            <span className="rounded-md bg-[hsl(var(--brand-bronze)/0.14)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--brand-bronze))]">
              Overføres ikke til regnskap
            </span>
          )}
        </div>
      )}
    </button>
  );
}
