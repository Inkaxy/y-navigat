import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BigButton } from "./BigButton";
import { PaymentMethodGrid } from "./PaymentMethodGrid";
import type { PaymentMethod } from "@/pos_styring/lib/pos-types";
import {
  buildPaymentSummary,
  roundCash,
  verifyAgainstTotal,
} from "@/kiosk/lib/payment";

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  totalIncl: number;
  submitting: boolean;
  errorMessage: string | null;
  onConfirm: (summary: ReturnType<typeof buildPaymentSummary>) => Promise<void> | void;
}

const QUICK_CASH = [200, 500, 1000];

export function PaymentModal({
  open,
  onOpenChange,
  totalIncl,
  submitting,
  errorMessage,
  onConfirm,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset state hver gang modal lukkes/åpnes på ny kurv.
  useEffect(() => {
    if (!open) {
      setMethod(null);
      setCashReceived("");
      setLocalError(null);
    }
  }, [open]);

  const cashRounded = useMemo(() => roundCash(totalIncl), [totalIncl]);
  const roundingDelta = useMemo(
    () => Math.round((cashRounded - totalIncl) * 100) / 100,
    [cashRounded, totalIncl],
  );
  const receivedNum = Number(cashReceived.replace(",", "."));
  const validReceived = Number.isFinite(receivedNum) && receivedNum >= cashRounded;
  const change = validReceived ? Math.round((receivedNum - cashRounded) * 100) / 100 : 0;

  const canConfirm =
    !submitting &&
    method != null &&
    (method !== "cash" || validReceived) &&
    method !== "invoice"; // faktura disabled (stub) i K.1c

  const handleConfirm = async () => {
    setLocalError(null);
    if (!method) return;
    try {
      const summary = buildPaymentSummary({
        method,
        totalIncl,
        cashReceived: method === "cash" ? receivedNum : undefined,
      });
      verifyAgainstTotal(summary, totalIncl);
      await onConfirm(summary);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-white/10 bg-[#1B1410] text-[#F4ECDC]">
        <DialogHeader>
          <DialogTitle className="text-xl">Betaling</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl bg-white/5 p-5 text-center">
            <div className="text-xs uppercase tracking-wider text-[#F4ECDC]/50">
              Å betale
            </div>
            <div className="mt-1 text-5xl font-bold tabular-nums">
              {totalIncl.toFixed(2)}
            </div>
          </div>

          <PaymentMethodGrid
            selected={method}
            onSelect={(m) => {
              setMethod(m);
              setLocalError(null);
            }}
          />

          {method === "cash" && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between text-sm text-[#F4ECDC]/70">
                <span>Avrundet (kontant)</span>
                <span className="tabular-nums">
                  {cashRounded.toFixed(2)}{" "}
                  <span className="text-xs text-[#F4ECDC]/40">
                    ({roundingDelta >= 0 ? "+" : ""}
                    {roundingDelta.toFixed(2)})
                  </span>
                </span>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#F4ECDC]/50">
                  Mottatt
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-2xl tabular-nums text-[#F4ECDC] outline-none focus:border-amber-400"
                  placeholder={cashRounded.toFixed(0)}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setCashReceived(String(cashRounded))}
                  className="flex-1 rounded-lg bg-white/10 py-2 text-sm font-medium hover:bg-white/15"
                >
                  Eksakt
                </button>
                {QUICK_CASH.filter((v) => v >= cashRounded).map((v) => (
                  <button
                    key={v}
                    onClick={() => setCashReceived(String(v))}
                    className="flex-1 rounded-lg bg-white/10 py-2 text-sm font-medium hover:bg-white/15"
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-white/10 pt-3 text-lg">
                <span className="text-[#F4ECDC]/70">Veksel</span>
                <span className="text-2xl font-bold tabular-nums text-amber-400">
                  {change.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {method === "invoice" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Faktura krever kunde-valg — bygges senere.
            </div>
          )}

          {(localError || errorMessage) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {localError ?? errorMessage}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <BigButton
              variant="secondary"
              className="flex-1 text-base"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Avbryt
            </BigButton>
            <BigButton
              className="flex-[2] text-base"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              {submitting ? "Lagrer…" : "Fullfør salg"}
            </BigButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
