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
  effectiveMvaRate,
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
  /** Sats ved takeaway / standardsats for produktet. */
  base_mva_rate: number;
  /** Sats ved sitt her. NULL = ikke matvare. */
  eatin_mva_rate: number | null;
  dining_mode_override?: DiningMode | null;
};

interface Ctx {
  items: CartItem[];
  totals: CartTotals;
  diningMode: DiningMode;
  addItem: (i: AddItemInput) => void;
  updateQuantity: (lineId: string, qty: number) => void;
  removeItem: (lineId: string) => void;
  applyLineDiscount: (lineId: string, amount: number) => void;
  setLineDiningOverride: (
    lineId: string,
    mode: DiningMode | null,
  ) => void;
  setDiningMode: (m: DiningMode) => void;
  effectiveMvaRate: (item: CartItem) => number;
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
  const totals = useMemo(() => calcTotals(items, diningMode), [items, diningMode]);

  useEffect(() => {
    void broadcastCart(channel, serializeForCustomer(items, totals, diningMode));
  }, [items, totals, diningMode, channel]);

  const addItem = useCallback((i: AddItemInput) => {
    const qty = i.quantity ?? 1;
    setItems((prev) => {
      if (i.product_id && i.dining_mode_override == null) {
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
      const newItem: CartItem = {
        id: crypto.randomUUID(),
        product_id: i.product_id,
        product_snapshot: i.product_snapshot,
        quantity: qty,
        unit_price_excl_mva: i.unit_price_excl_mva,
        base_mva_rate: i.base_mva_rate,
        eatin_mva_rate: i.eatin_mva_rate,
        line_discount: 0,
        dining_mode_override: i.dining_mode_override ?? null,
      };
      return [...prev, newItem];
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

  const setLineDiningOverride = useCallback(
    (lineId: string, mode: DiningMode | null) => {
      setItems((prev) =>
        prev.map((p) =>
          p.id === lineId ? { ...p, dining_mode_override: mode } : p,
        ),
      );
    },
    [],
  );

  const setDiningMode = useCallback((m: DiningMode) => setDining(m), []);

  const clear = useCallback(() => {
    setItems([]);
    setDining("takeaway");
  }, []);

  const effective = useCallback(
    (item: CartItem) => effectiveMvaRate(item, diningMode),
    [diningMode],
  );

  const value = useMemo<Ctx>(
    () => ({
      items,
      totals,
      diningMode,
      addItem,
      updateQuantity,
      removeItem,
      applyLineDiscount,
      setLineDiningOverride,
      setDiningMode,
      effectiveMvaRate: effective,
      clear,
    }),
    [
      items,
      totals,
      diningMode,
      addItem,
      updateQuantity,
      removeItem,
      applyLineDiscount,
      setLineDiningOverride,
      setDiningMode,
      effective,
      clear,
    ],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useCart() {
  const v = useContext(C);
  if (!v) throw new Error("useCart must be used inside CartProvider");
  return v;
}
