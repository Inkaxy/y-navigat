import type { CartTotals as T } from "@/kiosk/lib/cart";

export function CartTotals({ totals }: { totals: T }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between text-[#F4ECDC]/70">
        <span>Sum eks. mva</span>
        <span className="tabular-nums">{totals.subtotal_excl_mva.toFixed(2)}</span>
      </div>
      {totals.mva_breakdown.map((b) => (
        <div
          key={b.rate}
          className="flex justify-between text-xs text-[#F4ECDC]/50"
        >
          <span>MVA {b.rate}%</span>
          <span className="tabular-nums">{b.vat.toFixed(2)}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-lg font-bold">
        <span>Totalt</span>
        <span className="tabular-nums">{totals.total_incl_mva.toFixed(2)}</span>
      </div>
    </div>
  );
}
