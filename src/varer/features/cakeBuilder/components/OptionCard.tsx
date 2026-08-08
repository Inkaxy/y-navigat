import { Badge } from "@/components/ui/badge";
import { Cake, Check } from "lucide-react";
import { formatKr } from "@/varer/lib/pricing";
import { cn } from "@/lib/utils";
import type { WizardOption } from "../types";

interface OptionCardProps {
  option: WizardOption;
  selected: boolean;
  onClick: () => void;
  showVat: boolean;
  multi?: boolean;
}

export function OptionCard({ option, selected, onClick, showVat, multi }: OptionCardProps) {
  const displayPrice = showVat
    ? option.price_ex_mva * (1 + (option.mva_rate ?? 0) / 100)
    : option.price_ex_mva;

  const name = option.display_name || option.custom_name || "—";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "relative flex cursor-pointer flex-col gap-2.5 overflow-hidden rounded-xl border bg-surface-raised p-3 text-left transition-all hover:border-brand-gold/60 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/40",
        selected
          ? "border-brand-gold bg-brand-gold/10 shadow-card dark:bg-brand-gold/15"
          : "border-line-subtle",
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gold text-brand-ink-deep shadow">
          <Check className="h-4 w-4" />
        </span>
      )}

      <div className="aspect-square w-full overflow-hidden rounded-lg bg-surface-sunken flex items-center justify-center">
        {option.image_url ? (
          <img src={option.image_url} alt={name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Cake className="h-10 w-10 text-ink-tertiary/50" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug text-ink-primary line-clamp-2">{name}</div>
        {option.is_custom_only && (
          <Badge variant="outline" className="mt-1 text-[10px] border-line-subtle text-ink-tertiary">
            Kun navn
          </Badge>
        )}
      </div>

      {option.price_ex_mva > 0 ? (
        <div className="font-display text-sm text-ink-primary tabular-nums">
          + {formatKr(displayPrice)} kr
        </div>
      ) : (
        <div className="text-xs uppercase tracking-[0.12em] text-ink-tertiary">Inkludert</div>
      )}
    </div>
  );
}
