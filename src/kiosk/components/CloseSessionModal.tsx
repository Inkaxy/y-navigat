import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BigButton } from "./BigButton";
import {
  closeSession,
  fetchSessionCashSummary,
  type CashSummary,
} from "@/kiosk/lib/closeSession";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  openingFloat: number;
  onClosed: () => void;
}

function parseAmount(value: string): number | null {
  const s = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function CloseSessionModal({
  open,
  onOpenChange,
  sessionId,
  openingFloat,
  onClosed,
}: Props) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [counted, setCounted] = useState("");
  const [closing, setClosing] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [doneVariance, setDoneVariance] = useState<number | null>(null);

  // Reset + hent kontant-summer hver gang modalen åpnes
  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setSummaryError(null);
    setCounted("");
    setClosing("");
    setRpcError(null);
    setDoneVariance(null);
    setLoading(true);
    fetchSessionCashSummary(sessionId)
      .then((s) => setSummary(s))
      .catch((e: Error) => setSummaryError(e.message))
      .finally(() => setLoading(false));
  }, [open, sessionId]);

  const expectedCash = useMemo(() => {
    if (!summary) return null;
    return Math.round((openingFloat + summary.cash_total) * 100) / 100;
  }, [summary, openingFloat]);

  const countedNum = parseAmount(counted);
  const closingNum = parseAmount(closing);

  const variance =
    countedNum !== null && expectedCash !== null
      ? Math.round((countedNum - expectedCash) * 100) / 100
      : null;

  const canSubmit =
    !submitting &&
    !loading &&
    summary !== null &&
    countedNum !== null &&
    closingNum !== null &&
    doneVariance === null;

  const handleConfirm = async () => {
    if (countedNum === null || closingNum === null) return;
    setSubmitting(true);
    setRpcError(null);
    try {
      await closeSession({
        sessionId,
        closingFloat: closingNum,
        countedCash: countedNum,
      });
      setDoneVariance(variance ?? 0);
      toast.success("Skift avsluttet.");
    } catch (e) {
      const msg = (e as Error).message;
      setRpcError(msg);
      toast.error("Kunne ikke avslutte skift", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        if (!v && doneVariance !== null) onClosed();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg border-white/10 bg-[#1B1410] text-[#F4ECDC]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Avslutt skift</DialogTitle>
          <DialogDescription className="text-[#F4ECDC]/60">
            Tell kontanter i kassen og bekreft.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-8 text-center text-[#F4ECDC]/60">
            Henter oppgjør…
          </div>
        )}

        {summaryError && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {summaryError}
          </div>
        )}

        {doneVariance !== null ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-6">
              <div className="text-sm uppercase tracking-[0.2em] text-amber-400/80">
                Skift avsluttet
              </div>
              <div className="mt-3 grid grid-cols-2 gap-y-2 text-base">
                <div className="text-[#F4ECDC]/60">Forventet kontant</div>
                <div className="text-right tabular-nums">
                  {expectedCash?.toFixed(2)}
                </div>
                <div className="text-[#F4ECDC]/60">Talt</div>
                <div className="text-right tabular-nums">
                  {countedNum?.toFixed(2)}
                </div>
                <div className="text-[#F4ECDC]/60">Avvik</div>
                <div
                  className={`text-right tabular-nums font-semibold ${
                    doneVariance === 0
                      ? "text-emerald-300"
                      : doneVariance > 0
                        ? "text-amber-300"
                        : "text-red-300"
                  }`}
                >
                  {doneVariance > 0 ? "+" : ""}
                  {doneVariance.toFixed(2)}
                </div>
              </div>
            </div>
            <BigButton onClick={onClosed} className="w-full">
              Logg ut
            </BigButton>
          </div>
        ) : (
          summary && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="grid grid-cols-2 gap-y-1 text-sm">
                  <div className="text-[#F4ECDC]/60">Vekselbeholdning</div>
                  <div className="text-right tabular-nums">
                    {openingFloat.toFixed(2)}
                  </div>
                  <div className="text-[#F4ECDC]/60">Kontantsalg</div>
                  <div className="text-right tabular-nums">
                    {summary.cash_sales.toFixed(2)}
                  </div>
                  <div className="text-[#F4ECDC]/60">Kontantrefusjon</div>
                  <div className="text-right tabular-nums">
                    −{summary.cash_refunds.toFixed(2)}
                  </div>
                  <div className="mt-2 border-t border-white/10 pt-2 text-[#F4ECDC]/80">
                    Forventet i kassen
                  </div>
                  <div className="mt-2 border-t border-white/10 pt-2 text-right text-lg font-semibold tabular-nums">
                    {expectedCash?.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-[#F4ECDC]/70">
                    Talt kontant
                  </label>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-2xl font-semibold tabular-nums text-[#F4ECDC] focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-[#F4ECDC]/70">
                    Vekselbeholdning igjen
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={closing}
                    onChange={(e) => setClosing(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-2xl font-semibold tabular-nums text-[#F4ECDC] focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
                <div className="text-xs uppercase tracking-[0.2em] text-[#F4ECDC]/50">
                  Avvik
                </div>
                <div
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    variance === null
                      ? "text-[#F4ECDC]/40"
                      : variance === 0
                        ? "text-emerald-300"
                        : variance > 0
                          ? "text-amber-300"
                          : "text-red-300"
                  }`}
                >
                  {variance === null
                    ? "—"
                    : `${variance > 0 ? "+" : ""}${variance.toFixed(2)}`}
                </div>
              </div>

              {rpcError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {rpcError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <BigButton
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="border border-white/10"
                >
                  Avbryt
                </BigButton>
                <BigButton onClick={handleConfirm} disabled={!canSubmit}>
                  {submitting ? "Avslutter…" : "Bekreft og avslutt"}
                </BigButton>
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
