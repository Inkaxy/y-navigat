import { Check, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKr, type GroupDef } from "@/fakturering/lib/groups";

interface Props {
  def: GroupDef;
  customerCount: number;
  orderCount: number;
  sumExclVat: number;
  isEmpty: boolean;
  isInternal: boolean;
  isNonTransfer: boolean;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onPreview: () => void;
}

export function GroupCard({
  def, customerCount, orderCount, sumExclVat,
  isEmpty, isInternal, isNonTransfer, selected, disabled, onToggle, onPreview,
}: Props) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl border transition-all",
        selected
          ? "border-[hsl(var(--app-primary))] bg-[hsl(var(--app-primary)/0.06)] shadow-sm ring-1 ring-[hsl(var(--app-primary)/0.35)]"
          : "border-line-subtle bg-surface-raised hover:border-[hsl(var(--app-primary)/0.4)]",
        isEmpty && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || isEmpty}
        aria-pressed={selected}
        className={cn(
          "flex w-full flex-col gap-3 rounded-2xl p-5 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--app-primary))]",
          (disabled || isEmpty) && "cursor-not-allowed",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Gruppe {def.code}
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
          <span className="font-display text-4xl font-semibold tabular-nums text-text-primary">
            {customerCount}
          </span>
          <span className="text-xs text-muted-foreground">
            {customerCount === 1 ? "grunnlag" : "grunnlag"} · {orderCount}{" "}
            {orderCount === 1 ? "pakkseddel" : "pakksedler"}
          </span>
        </div>

        <div className={cn(
          "text-base font-semibold tabular-nums",
          isEmpty ? "text-muted-foreground" : "text-text-primary",
        )}>
          {isEmpty ? "—" : formatKr(sumExclVat)}
          {!isEmpty && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">u/mva</span>}
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

      <button
        type="button"
        onClick={onPreview}
        disabled={isEmpty}
        aria-label={`Forhåndsvis grunnlag for ${def.label}`}
        title="Forhåndsvis grunnlag"
        className={cn(
          "absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-lg border border-line-subtle bg-surface text-muted-foreground transition-colors",
          "hover:border-[hsl(var(--app-primary)/0.5)] hover:text-[hsl(var(--app-primary))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--app-primary))]",
          isEmpty && "pointer-events-none opacity-40",
        )}
      >
        <Eye className="h-4 w-4" />
      </button>
    </div>
  );
}
