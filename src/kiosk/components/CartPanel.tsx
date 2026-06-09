import { useState } from "react";
import { useCart } from "@/kiosk/context/CartContext";
import { CartLine } from "./CartLine";
import { CartTotals } from "./CartTotals";
import { BigButton } from "./BigButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  onPay: () => void;
}

export function CartPanel({ onPay }: Props) {
  const { items, totals, diningMode, setDiningMode, clear } = useCart();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isEmpty = items.length === 0;

  return (
    <aside className="flex w-96 flex-col rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F4ECDC]/60">
          Kurv · {items.length}
        </h2>
        <div className="flex gap-1 rounded-md bg-white/5 p-0.5 text-xs">
          <button
            onClick={() => setDiningMode("takeaway")}
            className={
              "rounded px-2 py-1 transition-colors " +
              (diningMode === "takeaway"
                ? "bg-amber-500 text-[#1B1410]"
                : "text-[#F4ECDC]/70")
            }
          >
            Take away
          </button>
          <button
            onClick={() => setDiningMode("eatin")}
            className={
              "rounded px-2 py-1 transition-colors " +
              (diningMode === "eatin"
                ? "bg-amber-500 text-[#1B1410]"
                : "text-[#F4ECDC]/70")
            }
          >
            Spise her
          </button>
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-[#F4ECDC]/40">
            Trykk på et produkt for å legge til.
          </div>
        ) : (
          items.map((it) => <CartLine key={it.id} item={it} />)
        )}
      </div>

      <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
        <CartTotals totals={totals} />
        <div className="flex gap-2">
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <BigButton
                variant="secondary"
                disabled={isEmpty}
                className="flex-1 text-base"
              >
                Tøm
              </BigButton>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Tømme kurv?</AlertDialogTitle>
                <AlertDialogDescription>
                  Alle linjer fjernes. Dette kan ikke angres.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    clear();
                    setConfirmOpen(false);
                  }}
                >
                  Tøm kurv
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <BigButton
            className="flex-[2] text-base"
            disabled={isEmpty}
            onClick={() => toast.info("Betaling bygges i K.1c")}
          >
            Betal
          </BigButton>
        </div>
      </div>
    </aside>
  );
}
