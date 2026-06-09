import { Minus, Plus, X } from "lucide-react";
import { calcLine, type CartItem } from "@/kiosk/lib/cart";
import { useCart } from "@/kiosk/context/CartContext";

export function CartLine({ item }: { item: CartItem }) {
  const { updateQuantity, removeItem } = useCart();
  const { gross } = calcLine(item);
  const snap = item.product_snapshot;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{snap.display_name}</div>
        <div className="truncate text-xs text-[#F4ECDC]/50">
          {snap.display_number ? `#${snap.display_number} · ` : ""}
          {item.unit_price_excl_mva.toFixed(2)} × {item.quantity}
          {snap.unit ? ` ${snap.unit}` : ""}
          {item.line_discount > 0 ? ` · −${item.line_discount.toFixed(2)}` : ""}
          {item.dining_mode_override
            ? ` · ${item.dining_mode_override === "eatin" ? "Spise her" : "Take away"}`
            : ""}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
          aria-label="Reduser antall"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-white/5 active:scale-95"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">
          {item.quantity}
        </span>
        <button
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
          aria-label="Øk antall"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-white/5 active:scale-95"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="w-20 text-right text-sm font-bold tabular-nums">
        {gross.toFixed(2)}
      </div>
      <button
        onClick={() => removeItem(item.id)}
        aria-label="Slett linje"
        className="flex h-10 w-10 items-center justify-center rounded-md text-red-300/80 hover:bg-red-500/10 active:scale-95"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
