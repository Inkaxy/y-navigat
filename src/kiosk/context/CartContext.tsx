import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  calcTotals,
  serializeForCustomer,
  type CartItem,
  type CartTotals,
  type DiningMode,
} from "@/kiosk/lib/cart";
import { broadcastCart } from "@/kiosk/lib/realtime";
import type { ProductSnapshot } from "@/pos_styring/lib/pos-types";

export type AddItemInput = {
  product_id: string | null;
  product_snapshot: ProductSnapshot;
  quantity?: number;
  unit_price_excl_mva: number;
  mva_rate: number;
};

interface Ctx {
  items: CartItem[];
  totals: CartTotals;
  diningMode: DiningMode;
  addItem: (i: AddItemInput) => void;
  updateQuantity: (lineId: string, qty: number) => void;
  removeItem: (lineId: string) => void;
  applyLineDiscount: (lineId: string, amount: number) => void;
  setDiningMode: (m: DiningMode) => void;
  clear: () => void;
}

const C = createContext<Ctx | null>(null);

export function CartProvider({
  channel,
  children,
}: {
  channel: RealtimeChannel;
  children: ReactNode;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [diningMode, setDining] = useState<DiningMode>("takeaway");
  const totals = useMemo(() => calcTotals(items), [items]);

  // Broadcast hver gang state endrer seg (idempotent — kunde-skjerm overskriver).
  useEffect(() => {
    void broadcastCart(channel, serializeForCustomer(items, totals, diningMode));
  }, [items, totals, diningMode, channel]);

  const addItem = useCallback((i: AddItemInput) => {
    const qty = i.quantity ?? 1;
    setItems((prev) => {
      if (i.product_id) {
        // Slå sammen med eksisterende linje hvis samme produkt, samme pris,
        // ingen rabatt og ingen dining_mode_override.
        const idx = prev.findIndex(
          (p) =>
            p.product_id === i.product_id &&
            p.unit_price_excl_mva === i.unit_price_excl_mva &&
            p.line_discount === 0 &&
            !p.dining_mode_override,
        );
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
          return copy;
        }
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          product_id: i.product_id,
          product_snapshot: i.product_snapshot,
          quantity: qty,
          unit_price_excl_mva: i.unit_price_excl_mva,
          mva_rate: i.mva_rate,
          line_discount: 0,
        },
      ];
    });
  }, []);

  const updateQuantity = useCallback((lineId: string, qty: number) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((p) => p.id !== lineId)
        : prev.map((p) => (p.id === lineId ? { ...p, quantity: qty } : p)),
    );
  }, []);

  const removeItem = useCallback((lineId: string) => {
    setItems((prev) => prev.filter((p) => p.id !== lineId));
  }, []);

  const applyLineDiscount = useCallback((lineId: string, amount: number) => {
    setItems((prev) =>
      prev.map((p) => (p.id === lineId ? { ...p, line_discount: amount } : p)),
    );
  }, []);

  const setDiningMode = useCallback((m: DiningMode) => setDining(m), []);

  const clear = useCallback(() => {
    setItems([]);
    setDining("takeaway");
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      items,
      totals,
      diningMode,
      addItem,
      updateQuantity,
      removeItem,
      applyLineDiscount,
      setDiningMode,
      clear,
    }),
    [items, totals, diningMode, addItem, updateQuantity, removeItem, applyLineDiscount, setDiningMode, clear],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useCart() {
  const v = useContext(C);
  if (!v) throw new Error("useCart must be used inside CartProvider");
  return v;
}
