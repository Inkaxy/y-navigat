import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ReceiptView } from "@/kiosk/components/ReceiptView";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { useSession } from "@/kiosk/context/SessionContext";
import { CartProvider, useCart } from "@/kiosk/context/CartContext";
import {
  KeypadNavProvider,
  useKeypadNav,
} from "@/kiosk/context/KeypadNavContext";
import { useKeypadLayout, type KeypadData, type KeypadButton } from "@/kiosk/hooks/useKeypadLayout";
import {
  usePriceListConfig,
  useProductLookup,
} from "@/kiosk/hooks/useProductLookup";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { broadcastSaleComplete } from "@/kiosk/lib/realtime";
import { buildPaymentSummary } from "@/kiosk/lib/payment";
import {
  KioskRender,
  type RenderButton,
  type RenderCartLine,
  type RenderPage,
} from "@/kiosk/render/KioskRender";
import { parseTheme } from "@/kiosk/render/kioskTheme";
import { toLinePayload } from "@/kiosk/pages/Kasse";
import OperatorBoot from "@/kiosk/pages/OperatorBoot";

const IDLE_RESET_MS = 60_000;

export default function SelfServiceKasse() {
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const channel = useKioskChannel();
  const { session, status: sessionStatus, openSession } = useSession();

  // Auto-open session for self-service (opening_float = 0)
  const openingRef = useRef(false);
  useEffect(() => {
    if (sessionStatus === "no_session" && operator && !openingRef.current) {
      openingRef.current = true;
      openSession(0).then((res) => {
        openingRef.current = false;
        if (!res.ok) toast.error("Kunne ikke åpne selvbetjent-sesjon", { description: res.error });
      });
    }
  }, [sessionStatus, operator, openSession]);

  const legalEntityId = operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;
  const { data, isLoading, error } = useKeypadLayout(terminal!.id, legalEntityId);

  const rootPageId = useMemo(() => {
    if (!data) return null;
    return [...data.pages].sort((a, b) => a.sort_order - b.sort_order)[0]?.id ?? null;
  }, [data]);

  if (!operator) return <OperatorBoot label="Klargjør selvbetjent kasse…" />;
  if (sessionStatus !== "open" || !session) return <OperatorBoot label="Åpner sesjon…" />;

  return (
    <CartProvider channel={channel}>
      <KeypadNavProvider key={data?.layout.id ?? "none"} rootPageId={rootPageId}>
        <SelfServiceFlow
          data={data ?? null}
          loading={isLoading}
          loadError={error as Error | null}
        />
      </KeypadNavProvider>
    </CartProvider>
  );
}

interface FlowProps {
  data: KeypadData | null;
  loading: boolean;
  loadError: Error | null;
}

function SelfServiceFlow({ data, loading, loadError }: FlowProps) {
  const cart = useCart();
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const { session } = useSession();
  const channel = useKioskChannel();
  const nav = useKeypadNav();

  const priceListId = terminal?.default_price_list_id ?? null;
  const { data: priceListCfg } = usePriceListConfig(priceListId);
  const lookupProduct = useProductLookup(
    priceListId,
    priceListCfg?.prices_include_mva ?? false,
  );

  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receipt, setReceipt] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: any[];
  } | null>(null);

  const theme = parseTheme(data?.layout.theme ?? null);

  // Idle reset — clears cart after inactivity
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (cart.items.length === 0 || submitting || receipt) return;
    idleTimer.current = setTimeout(() => {
      cart.clear();
      nav.reset();
      toast.info("Tilbakestilt etter inaktivitet");
    }, IDLE_RESET_MS);
  }, [cart, nav, submitting, receipt]);

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdle]);

  const handleProduct = async (b: KeypadButton) => {
    if (!b.product_id || !priceListId) {
      toast.error("Produkt ikke tilgjengelig");
      return;
    }
    try {
      const p = await lookupProduct(b.product_id);
      if (!p) {
        toast.error(`${b.display_label ?? "Produkt"}: utilgjengelig`);
        return;
      }
      cart.addItem({
        product_id: p.id,
        product_snapshot: {
          display_name: p.display_name,
          display_number: String(p.display_number),
          unit: p.unit_of_sale,
          mva_rate: p.mva_rate,
        },
        unit_price_excl_mva: p.unit_price_excl_mva,
        base_mva_rate: p.mva_rate,
        eatin_mva_rate: p.eatin_mva_rate,
        quantity: 1,
      });
    } catch (e) {
      toast.error("Feil ved produkt-oppslag", { description: (e as Error).message });
    }
  };

  const handleButtonClick = (rb: RenderButton) => {
    if (!data) return;
    const b = data.buttons.find((x) => x.id === rb.id);
    if (!b) return;
    if (b.button_type === "product") void handleProduct(b);
    else if (b.button_type === "category" && b.target_page_id) nav.navigateTo(b.target_page_id);
    // function-knapper er filtrert bort i selvbetjent
  };

  const handlePay = async () => {
    if (!session || cart.items.length === 0) return;
    setSubmitting(true);
    try {
      const summary = buildPaymentSummary({
        method: "card",
        totalIncl: cart.totals.total_incl_mva,
      });
      const linesPayload = cart.items.map((it) => toLinePayload(it, cart.diningMode));
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
      if (!tx) throw new Error("Fant ikke transaksjonen");

      setReceipt({ tx, lines: lines ?? [] });
      void broadcastSaleComplete(channel, {
        receipt_number: (tx as { receipt_number: string | null }).receipt_number ?? null,
        total_incl_mva: Number((tx as { total_incl_mva: number }).total_incl_mva),
        change_given: 0,
        timestamp: Date.now(),
      });
    } catch (e) {
      toast.error("Betaling feilet", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewSale = () => {
    setReceipt(null);
    cart.clear();
    nav.reset();
  };

  const renderPages: RenderPage[] = useMemo(() => {
    if (!data) return [];
    return data.pages.map((p) => ({
      id: p.id,
      page_name: p.page_name,
      sort_order: p.sort_order,
      background_color: p.background_color,
      icon: p.icon ?? null,
    }));
  }, [data]);

  const renderButtons: RenderButton[] = useMemo(() => {
    if (!data) return [];
    return data.buttons
      .filter((b) => !b.hidden_in_self_service && b.button_type !== "function")
      .map((b) => {
        const showImage = b.show_image ?? data.layout.show_product_image ?? true;
        const productPath =
          b.button_type === "product" && b.product_id
            ? data.productPrimaryPaths[b.product_id] ?? null
            : null;
        const productFallback =
          b.button_type === "product" && b.product_id
            ? data.productFallbackUrls[b.product_id] ?? null
            : null;
        const productName =
          b.button_type === "product" && b.product_id
            ? data.productDisplayNames[b.product_id] ?? null
            : null;
        const resolvedPath = b.image_storage_path || productPath;

        return {
          id: b.id,
          page_id: b.page_id,
          button_type: (b.button_type as RenderButton["button_type"]) ?? "product",
          display_label: b.display_label || productName,
          image_url: showImage
            ? (resolvedPath && data.imageUrls[resolvedPath]) || b.image_url || productFallback || null
            : null,
          background_color: b.background_color,
          text_color: b.text_color,
          grid_x: b.grid_x,
          grid_y: b.grid_y,
          grid_width: b.grid_width,
          grid_height: b.grid_height,
        };
      });
  }, [data]);

  const renderCart: RenderCartLine[] = cart.items.map((it) => {
    const productPath = it.product_id ? data?.productPrimaryPaths[it.product_id] ?? null : null;
    const signed = productPath ? data?.imageUrls[productPath] ?? null : null;
    const fallback = it.product_id ? data?.productFallbackUrls[it.product_id] ?? null : null;
    return {
      id: it.id,
      label: it.product_snapshot.display_name,
      qty: it.quantity,
      unit: it.product_snapshot.unit ?? null,
      line_total:
        Math.round(
          (it.quantity * it.unit_price_excl_mva - it.line_discount) *
            (1 + cart.effectiveMvaRate(it) / 100) *
            100,
        ) / 100,
      image_url: signed ?? fallback ?? null,
    };
  });

  const headerRight = cart.items.length > 0 ? (
    <button
      type="button"
      onClick={() => setCancelOpen(true)}
      className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-semibold hover:bg-white/10"
      style={{ color: "var(--kiosk-header-ink)" }}
    >
      <X className="h-4 w-4" /> Avbryt
    </button>
  ) : null;

  const diningForRender: "takeaway" | "eatin" | "pickup" = cart.diningMode;
  const handleDiningChange = (m: "takeaway" | "eatin" | "pickup") => {
    if (m === "pickup") return; // ikke tilgjengelig i selvbetjent
    cart.setDiningMode(m);
  };

  return (
    <div
      className="flex h-screen w-screen flex-col"
      onPointerDown={resetIdle}
      onKeyDown={resetIdle}
    >
      {loading ? (
        <div
          className="flex flex-1 items-center justify-center"
          style={{
            background: theme.bg,
            color: theme.ink,
          }}
        >
          Laster…
        </div>
      ) : loadError ? (
        <div className="flex flex-1 items-center justify-center bg-red-950 p-8 text-red-200">
          Feil: {loadError.message}
        </div>
      ) : (
        <KioskRender
          theme={theme}
          gridCols={data?.layout.grid_cols ?? 5}
          gridRows={data?.layout.grid_rows ?? 4}
          pages={renderPages}
          buttons={renderButtons}
          currentPageId={nav.currentPageId}
          onPageChange={(id) => nav.replaceTo(id)}
          canGoBack={nav.canGoBack}
          onBack={() => nav.goBack()}
          cart={renderCart}
          total={cart.totals.total_incl_mva}
          headerLabel="Selvbetjent kasse"
          headerTerminalCode={terminal?.terminal_code ?? null}
          headerOperatorName={null}
          headerRight={headerRight}
          interactive
          onButtonClick={handleButtonClick}
          onPay={handlePay}
          payDisabled={submitting || cart.items.length === 0}
          onCartLineQtyChange={(id, delta) => {
            const it = cart.items.find((x) => x.id === id);
            if (!it) return;
            const next = it.quantity + delta;
            if (next <= 0) cart.removeItem(id);
            else cart.updateQuantity(id, next);
          }}
          onCartLineRemove={(id) => cart.removeItem(id)}
          diningMode={diningForRender}
          onDiningChange={handleDiningChange}
          emptyState={
            <div className="text-center">
              <p
                className="text-3xl font-semibold"
                style={{ color: "var(--kiosk-ink)" }}
              >
                Velkommen
              </p>
              <p
                className="mt-3 text-base"
                style={{ color: "var(--kiosk-ink-soft)" }}
              >
                {data
                  ? "Velg fra menyen for å starte bestillingen"
                  : "Ingen tastatur konfigurert"}
              </p>
            </div>
          }
        />
      )}

      <ReceiptView
        open={!!receipt}
        tx={receipt?.tx ?? null}
        lines={receipt?.lines ?? []}
        terminalName={terminal?.display_name ?? ""}
        onNewSale={handleNewSale}
        // Selvbetjent: ingen kvitterings-print her, antas autoprint senere
        onPrintReceipt={async () => {
          toast.info("Kvittering sendes automatisk i selvbetjent modus");
        }}
        printingReceipt={false}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avbryte bestilling?</AlertDialogTitle>
            <AlertDialogDescription>
              Alt i kurven fjernes og du går tilbake til startsiden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fortsett bestilling</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cart.clear();
                nav.reset();
                setCancelOpen(false);
              }}
            >
              Avbryt bestilling
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
