import { CreditCard, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaymentMode = "now" | "later";

interface Props {
  value: PaymentMode | null;
  onChange: (m: PaymentMode) => void;
  totalIncMva: number;
}

export function PaymentChoiceStep({ value, onChange, totalIncMva }: Props) {
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Betaling</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Skal kaken betales nå, eller når kunden henter den?
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onChange("now")}
          className={cn(
            "rounded-xl border-2 p-6 text-left transition-all hover:shadow-md",
            value === "now"
              ? "border-app bg-app/5 ring-2 ring-app/30"
              : "border-border bg-card",
          )}
        >
          <CreditCard className="h-8 w-8 mb-3 text-app" />
          <div className="font-semibold text-base">Betal nå</div>
          <div className="text-xs text-muted-foreground mt-1">
            Kunden betaler {totalIncMva.toFixed(2)} kr i kassen nå. Kaken er
            registrert som betalt henteordre.
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChange("later")}
          className={cn(
            "rounded-xl border-2 p-6 text-left transition-all hover:shadow-md",
            value === "later"
              ? "border-app bg-app/5 ring-2 ring-app/30"
              : "border-border bg-card",
          )}
        >
          <Wallet className="h-8 w-8 mb-3 text-app" />
          <div className="font-semibold text-base">Betal ved henting</div>
          <div className="text-xs text-muted-foreground mt-1">
            Kunden betaler når kaken hentes. Ordren legges som ubetalt
            henteordre.
          </div>
        </button>
      </div>
    </div>
  );
}
