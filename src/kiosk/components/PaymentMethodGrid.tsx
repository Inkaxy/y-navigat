import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/pos_styring/lib/pos-types";
import { cn } from "@/lib/utils";

const ORDER: PaymentMethod[] = ["cash", "card", "vipps", "invoice", "gift_card", "other"];

interface Props {
  selected: PaymentMethod | null;
  onSelect: (m: PaymentMethod) => void;
  disabledMethods?: PaymentMethod[];
}

export function PaymentMethodGrid({ selected, onSelect, disabledMethods = [] }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {ORDER.map((m) => {
        const isSel = selected === m;
        const disabled = disabledMethods.includes(m);
        return (
          <button
            key={m}
            disabled={disabled}
            onClick={() => onSelect(m)}
            className={cn(
              "min-h-[96px] select-none rounded-2xl border-2 px-4 py-3 text-lg font-semibold transition-all active:scale-[0.97]",
              isSel
                ? "border-amber-400 bg-amber-500 text-[#1B1410]"
                : "border-white/10 bg-white/5 text-[#F4ECDC] hover:bg-white/10",
              disabled && "cursor-not-allowed opacity-40",
            )}
          >
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}
