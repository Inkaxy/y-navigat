import { useMemo, useState } from "react";
import { toast } from "sonner";
import { KioskHeader } from "@/kiosk/components/KioskHeader";
import { KeypadGrid } from "@/kiosk/components/KeypadGrid";
import { CartPanel } from "@/kiosk/components/CartPanel";
import { PaymentModal } from "@/kiosk/components/PaymentModal";
import { ReceiptView } from "@/kiosk/components/ReceiptView";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { useSession } from "@/kiosk/context/SessionContext";
import { CartProvider, useCart, type AddItemInput } from "@/kiosk/context/CartContext";
import {
  KeypadNavProvider,
  useKeypadNav,
} from "@/kiosk/context/KeypadNavContext";
import { useKeypadLayout, type KeypadData } from "@/kiosk/hooks/useKeypadLayout";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { broadcastSaleComplete } from "@/kiosk/lib/realtime";
import type { CartItem } from "@/kiosk/lib/cart";

// ─── RPC line-payload: eksakt 7-nøkkel-shape RPC-en leser ────────────────────
type LinePayload = {
  product_id: string | null;
  product_snapshot: AddItemInput["product_snapshot"];
  quantity: number;
  unit_price_excl_mva: number;
  line_discount: number;
  mva_rate: number;
  dining_mode_override: "takeaway" | "eatin" | null;
};

export function toLinePayload(item: CartItem): LinePayload {
  return {
    product_id: item.product_id,
    product_snapshot: item.product_snapshot,
    quantity: item.quantity,
    unit_price_excl_mva: item.unit_price_excl_mva,
    line_discount: item.line_discount ?? 0,
    mva_rate: item.mva_rate,
    dining_mode_override: item.dining_mode_override ?? null,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

export default function Kasse() {
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const channel = useKioskChannel();
  const legalEntityId =
    operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;

  const { data, isLoading, error } = useKeypadLayout(
    terminal!.id,
    legalEntityId,
  );

  const rootPageId = useMemo(() => {
    if (!data) return null;
    return (
      [...data.pages].sort((a, b) => a.sort_order - b.sort_order)[0]?.id ??
      null
    );
  }, [data]);

  return (
    <CartProvider channel={channel}>
      <KeypadNavProvider key={data?.layout.id ?? "none"} rootPageId={rootPageId}>
        <div className="flex min-h-screen flex-col bg-[#0F0E0E] text-[#F4ECDC]">
          <KioskHeader />
          <SaleFlow data={data ?? null} loading={isLoading} loadError={error as Error | null} />
        </div>
      </KeypadNavProvider>
    </CartProvider>
  );
}

interface SaleFlowProps {
  data: KeypadData | null;
  loading: boolean;
  loadError: Error | null;
}

function SaleFlow({ data, loading, loadError }: SaleFlowProps) {
  const cart = useCart();
  const { terminal } = useTerminal();
  const { session } = useSession();
  const channel = useKioskChannel();
  const nav = useKeypadNav();

  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: any[];
  } | null>(null);

  const handleConfirm = async (summary: {
    payments: { method: string; amount: number; reference?: string; card_brand?: string }[];
    total_paid: number;
    rounding: number;
    change_given: number;
  }) => {
    if (!session) {
      setRpcError("Ingen åpen sesjon.");
      return;
    }
    // Bekreft mva-satser før kall (RPC avviser annet enn 0/12/15/25).
    const VALID = new Set([0, 12, 15, 25]);
    for (const it of cart.items) {
      if (!VALID.has(it.mva_rate)) {
        setRpcError(`Ugyldig mva-sats ${it.mva_rate}% på «${it.product_snapshot.display_name}»`);
        return;
      }
    }

    setSubmitting(true);
    setRpcError(null);
    try {
      const linesPayload = cart.items.map(toLinePayload);
      const { data: txId, error } = await kioskSupabase.rpc(
        "pos_record_sale" as never,
        {
          p_session_id: session.id,
          p_lines: linesPayload,
          p_payment_summary: summary,
          p_dining_mode: cart.diningMode,
        } as never,
      );
      if (error) throw error;
      const id = txId as unknown as string;

      const [{ data: tx, error: txErr }, { data: lines, error: linesErr }] =
        await Promise.all([
          kioskSupabase
            .from("pos_transactions")
            .select(
              "id, receipt_number, receipt_sequence, created_at, dining_mode, subtotal_excl_mva, total_mva, total_incl_mva, mva_breakdown, payment_summary",
            )
            .eq("id", id)
            .single(),
          kioskSupabase
            .from("pos_transaction_lines")
            .select(
              "id, line_number, product_snapshot, quantity, unit_price_excl_mva, line_discount, mva_rate, line_subtotal_excl_mva, line_mva, line_total_incl_mva",
            )
            .eq("transaction_id", id)
            .order("line_number"),
        ]);
      if (txErr) throw txErr;
      if (linesErr) throw linesErr;
      if (!tx) throw new Error("Fant ikke transaksjonen etter insert");

      setReceipt({ tx, lines: lines ?? [] });
      setPayOpen(false);

      void broadcastSaleComplete(channel, {
        receipt_number: (tx as { receipt_number: string | null }).receipt_number ?? null,
        total_incl_mva: Number((tx as { total_incl_mva: number }).total_incl_mva),
        change_given: summary.change_given,
        timestamp: Date.now(),
      });
    } catch (e) {
      setRpcError((e as Error).message);
      toast.error("Salg feilet", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewSale = () => {
    setReceipt(null);
    cart.clear();
    nav.reset();
  };

  return (
    <>
      <div className="flex flex-1 gap-4 p-4">
        <div className="flex flex-1 flex-col">
          {loading && (
            <div className="flex flex-1 items-center justify-center text-[#F4ECDC]/60">
              Laster tastatur…
            </div>
          )}
          {loadError && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center text-red-300">
              Feil ved lasting av tastatur: {loadError.message}
            </div>
          )}
          {!loading && !loadError && !data && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
              <div>
                <p className="text-lg font-medium text-[#F4ECDC]/80">
                  Ingen tastatur konfigurert
                </p>
                <p className="mt-2 max-w-md text-sm text-[#F4ECDC]/50">
                  Det finnes ingen layout bundet til denne terminalen, og ingen
                  default-layout for selskapet. Åpne POS Styring → Tastatur for
                  å sette opp et tastatur.
                </p>
              </div>
            </div>
          )}
          {data && <KeypadGrid data={data} />}
        </div>

        <CartPanel
          onPay={() => {
            if (cart.items.length === 0) return;
            setRpcError(null);
            setPayOpen(true);
          }}
        />
      </div>

      <PaymentModal
        open={payOpen}
        onOpenChange={(v) => {
          if (!submitting) setPayOpen(v);
        }}
        totalIncl={cart.totals.total_incl_mva}
        submitting={submitting}
        errorMessage={rpcError}
        onConfirm={handleConfirm}
      />
      <ReceiptView
        open={!!receipt}
        tx={receipt?.tx ?? null}
        lines={receipt?.lines ?? []}
        terminalName={terminal?.display_name ?? ""}
        onNewSale={handleNewSale}
      />
    </>
  );
}
