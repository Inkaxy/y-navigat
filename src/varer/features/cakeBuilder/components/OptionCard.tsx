import { Card } from "@/components/ui/card";
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
    <Card
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
        "relative overflow-hidden cursor-pointer transition-all hover:border-primary/60 hover:shadow-md p-3 flex flex-col gap-2",
        selected && "border-primary ring-2 ring-primary/30 bg-primary/5",
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Check className="h-4 w-4" />
        </span>
      )}

      <div className="aspect-square w-full overflow-hidden rounded-md bg-muted flex items-center justify-center">
        {option.image_url ? (
          <img src={option.image_url} alt={name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Cake className="h-10 w-10 text-muted-foreground/50" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight line-clamp-2">{name}</div>
        {option.is_custom_only && (
          <Badge variant="outline" className="mt-1 text-[10px]">
            Kun navn
          </Badge>
        )}
      </div>

      <div className="text-sm font-semibold text-primary">
        {option.price_ex_mva > 0 ? `+ ${formatKr(displayPrice)} kr` : "Inkludert"}
      </div>
    </Card>
  );
}
