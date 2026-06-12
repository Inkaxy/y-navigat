import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BigButton } from "./BigButton";
import {
  parseMvaBreakdown,
  parsePaymentSummary,
  parseProductSnapshot,
} from "@/pos_styring/lib/pos-types";

interface TxRow {
  id: string;
  receipt_number: string | null;
  receipt_sequence: number | null;
  created_at: string;
  dining_mode: string;
  subtotal_excl_mva: number;
  total_mva: number;
  total_incl_mva: number;
  mva_breakdown: unknown;
  payment_summary: unknown;
}

interface LineRow {
  id: string;
  line_number: number;
  product_snapshot: unknown;
  quantity: number;
  unit_price_excl_mva: number;
  line_discount: number;
  mva_rate: number;
  line_subtotal_excl_mva: number;
  line_mva: number;
  line_total_incl_mva: number;
}

interface Props {
  open: boolean;
  tx: TxRow | null;
  lines: LineRow[];
  terminalName: string;
  onNewSale: () => void;
  onPrintReceipt?: () => void;
  printingReceipt?: boolean;
}

export function ReceiptView({ open, tx, lines, terminalName, onNewSale, onPrintReceipt, printingReceipt }: Props) {
  if (!tx) return null;
  const mva = parseMvaBreakdown(tx.mva_breakdown);
  const pay = parsePaymentSummary(tx.payment_summary);
  const change = pay.change_given ?? 0;
  const ts = new Date(tx.created_at);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-lg border-white/10 bg-[#1B1410] text-[#F4ECDC]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Kvittering</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 font-mono text-sm">
          <div className="text-center">
            <div className="text-base font-semibold">{terminalName}</div>
            <div className="mt-1 text-[#F4ECDC]/60">
              {tx.receipt_number ?? `#${tx.receipt_sequence ?? "?"}`}
            </div>
            <div className="text-xs text-[#F4ECDC]/50">
              {ts.toLocaleString("nb-NO")}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-[#F4ECDC]/40">
              {tx.dining_mode === "eatin" ? "Spise her" : "Take away"}
            </div>
          </div>

          <div className="space-y-1 border-y border-white/10 py-3">
            {lines.map((l) => {
              const snap = parseProductSnapshot(l.product_snapshot);
              return (
                <div key={l.id} className="flex justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{snap.display_name}</div>
                    <div className="text-xs text-[#F4ECDC]/50">
                      {l.quantity} × {l.unit_price_excl_mva.toFixed(2)}
                      {l.line_discount > 0 && ` − ${l.line_discount.toFixed(2)}`}
                    </div>
                  </div>
                  <div className="tabular-nums">
                    {Number(l.line_total_incl_mva).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1">
            <Row label="Sum eks. mva" value={Number(tx.subtotal_excl_mva).toFixed(2)} />
            {mva.map((m) => (
              <Row
                key={m.rate}
                label={`Mva ${m.rate}%`}
                value={m.vat.toFixed(2)}
                muted
              />
            ))}
            <Row label="Sum mva" value={Number(tx.total_mva).toFixed(2)} muted />
            <div className="mt-2 flex justify-between border-t border-white/20 pt-2 text-lg font-bold">
              <span>Totalt</span>
              <span className="tabular-nums">
                {Number(tx.total_incl_mva).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="space-y-1 border-t border-white/10 pt-3">
            {pay.payments.map((p, i) => (
              <Row
                key={i}
                label={p.method}
                value={p.amount.toFixed(2)}
              />
            ))}
            <Row label="Betalt" value={pay.total_paid.toFixed(2)} />
            {change > 0 && (
              <Row label="Veksel" value={change.toFixed(2)} bold />
            )}
          </div>

          <BigButton className="w-full text-base" onClick={onNewSale}>
            Nytt salg
          </BigButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={
        "flex justify-between " +
        (muted ? "text-[#F4ECDC]/60 " : "") +
        (bold ? "font-bold text-amber-400" : "")
      }
    >
      <span className="capitalize">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
