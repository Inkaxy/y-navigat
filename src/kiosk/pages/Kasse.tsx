import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { LogOut, X } from "lucide-react";
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
import { CloseSessionModal } from "@/kiosk/components/CloseSessionModal";
import { PaymentModal } from "@/kiosk/components/PaymentModal";
import { KakebyggerModal } from "@/kiosk/components/KakebyggerModal";
import { HenteordreModal, type PickupOrderRow, type PickupOrderLine } from "@/kiosk/components/HenteordreModal";
import { ReceiptView } from "@/kiosk/components/ReceiptView";
import { useReceiptHeader } from "@/kiosk/hooks/useReceiptHeader";
import { useTerminal } from "@/kiosk/context/TerminalContext";

import { useOperator } from "@/kiosk/context/OperatorContext";
import { useKioskChannel } from "@/kiosk/context/RealtimeContext";
import { useSession } from "@/kiosk/context/SessionContext";
import { CartProvider, useCart, type AddItemInput } from "@/kiosk/context/CartContext";
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
import { effectiveDining, isFoodItem, type CartItem } from "@/kiosk/lib/cart";
import {
  KioskRender,
  type RenderButton,
  type RenderCartLine,
  type RenderPage,
} from "@/kiosk/render/KioskRender";
import { parseTheme } from "@/kiosk/render/kioskTheme";

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

export function toLinePayload(
  item: CartItem,
  cartDining: "takeaway" | "eatin",
): LinePayload {
  const mode = item.dining_mode_override ?? cartDining;
  const effectiveRate =
    mode === "eatin" && item.eatin_mva_rate != null
      ? item.eatin_mva_rate
      : item.base_mva_rate;
  return {
    product_id: item.product_id,
    product_snapshot: item.product_snapshot,
    quantity: item.quantity,
    unit_price_excl_mva: item.unit_price_excl_mva,
    line_discount: item.line_discount ?? 0,
    mva_rate: effectiveRate,
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
        <SaleFlow data={data ?? null} loading={isLoading} loadError={error as Error | null} />
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
  const { operator, logout } = useOperator();
  const { session, status: sessionStatus } = useSession();
  const channel = useKioskChannel();
  const nav = useKeypadNav();

  const priceListId = terminal?.default_price_list_id ?? null;
  const { data: priceListCfg } = usePriceListConfig(priceListId);
  const receiptHeader = useReceiptHeader(
    operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null,
    terminal?.outlet_id ?? null,
  );

  const lookupProduct = useProductLookup(
    priceListId,
    priceListCfg?.prices_include_mva ?? false,
  );

  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [closeSessionOpen, setCloseSessionOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [kakebyggerOpen, setKakebyggerOpen] = useState(false);
  const [henteordreOpen, setHenteordreOpen] = useState(false);
  const [activePickupOrderId, setActivePickupOrderId] = useState<string | null>(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [receipt, setReceipt] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: any[];
  } | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: any[];
  } | null>(null);
  const [copyIssued, setCopyIssued] = useState(false);


  const theme = parseTheme(data?.layout.theme ?? null);
  const sessionOpen = sessionStatus === "open" && !!session;

  const handleProduct = async (b: KeypadButton) => {
    if (!b.product_id) {
      toast.error("Produkt-knapp mangler product_id");
      return;
    }
    if (!priceListId) {
      toast.error("Terminal mangler default_price_list_id");
      return;
    }
    try {
      const p = await lookupProduct(b.product_id);
      if (!p) {
        toast.error(`${b.display_label ?? "Produkt"}: mangler pris i prisliste`);
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
      toast.error("Feil ved produkt-oppslag", {
        description: (e as Error).message,
      });
    }
  };

  const handleCategory = (b: KeypadButton) => {
    if (!data) return;
    if (!b.target_page_id) {
      toast.warning(`${b.display_label ?? "Kategori"}: underside ikke konfigurert`);
      return;
    }
    const target = data.pages.find((p) => p.id === b.target_page_id);
    if (target) {
      nav.navigateTo(target.id);
    } else {
      toast.warning(`${b.display_label ?? "Kategori"}: underside finnes ikke i dette layoutet`);
    }
  };

  const handleButtonClick = (rb: RenderButton) => {
    if (!data) return;
    const b = data.buttons.find((x) => x.id === rb.id);
    if (!b) return;
    switch (b.button_type) {
      case "product":
        void handleProduct(b);
        return;
      case "category":
        handleCategory(b);
        return;
      case "function":
        if (b.function_code === "kakebygger") {
          setKakebyggerOpen(true);
          return;
        }
        if (b.function_code === "henteordre") {
          setHenteordreOpen(true);
          return;
        }
        toast.info(`${b.display_label ?? b.function_code ?? "Funksjon"}: bygges senere`);
        return;
      default:
        toast.info(`Knapp-type "${b.button_type}" ikke støttet ennå`);
    }
  };

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
    const VALID = new Set([0, 12, 15, 25]);
    for (const it of cart.items) {
      const eff = cart.effectiveMvaRate(it);
      if (!VALID.has(eff)) {
        setRpcError(`Ugyldig mva-sats ${eff}% på «${it.product_snapshot.display_name}»`);
        return;
      }
    }

    setSubmitting(true);
    setRpcError(null);
    try {
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
      if (!tx) throw new Error("Fant ikke transaksjonen etter insert");

      const r = { tx, lines: lines ?? [] };
      setReceipt(r);
      setLastReceipt(r);
      setPayOpen(false);
      if (activePickupOrderId) {
        await kioskSupabase.rpc("pos_complete_pickup_order" as never, {
          p_order_id: activePickupOrderId,
          p_pos_transaction_id: id,
        } as never);
        setActivePickupOrderId(null);
      }

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

  const handlePrintReceipt = async () => {
    const r = receipt ?? lastReceipt;
    if (!r || !terminal) {
      toast.error("Ingen kvittering å skrive ut");
      return;
    }
    setPrintingReceipt(true);
    try {
      const [{ data: mapping, error: mErr }, { data: entity, error: eErr }] =
        await Promise.all([
          kioskSupabase
            .from("pos_terminal_printers")
            .select("printer_id")
            .eq("terminal_id", terminal.id)
            .eq("role", "receipt")
            .maybeSingle(),
          kioskSupabase
            .from("legal_entities")
            .select(
              "legal_name, display_name, org_number, mva_registered, invoice_address_line1, invoice_address_line2, invoice_postal_code, invoice_city, contact_phone, contact_email",
            )
            .eq("id", terminal.legal_entity_id)
            .maybeSingle(),
        ]);
      if (mErr) throw mErr;
      if (eErr) throw eErr;
      if (!mapping?.printer_id) {
        toast.warning("Ingen kvitteringsskriver er koblet til terminalen", {
          description: "Konfigurer i POS Styring → Terminaler.",
        });
        return;
      }

      const company = entity
        ? {
            name: entity.display_name ?? entity.legal_name,
            org_number: entity.org_number,
            vat_registered: !!entity.mva_registered,
            address: [
              entity.invoice_address_line1,
              entity.invoice_address_line2,
              [entity.invoice_postal_code, entity.invoice_city]
                .filter(Boolean)
                .join(" "),
            ]
              .filter((s) => s && String(s).trim().length > 0)
              .join(", "),
            phone: entity.contact_phone,
            email: entity.contact_email,
          }
        : null;

      const footer_lines = [
        "Takk for at du handler hos",
        "den lokale bakeren!",
        "",
        "Nøtterø Bakeri",
      ];

      const { error: jErr } = await kioskSupabase
        .from("pos_print_jobs")
        .insert({
          printer_id: mapping.printer_id,
          terminal_id: terminal.id,
          job_type: "receipt",
          payload: {
            transaction: r.tx,
            lines: r.lines,
            terminal_name: terminal.display_name,
            terminal_id: terminal.id,
            operator_name: operator?.display_name ?? null,
            operator_code: operator?.code ?? null,
            company,
            outlet: receiptHeader.outlet,
            footer_lines,
          } as unknown as never,

          status: "queued",
        });

      if (jErr) throw jErr;
      toast.success("Kvittering lagt i utskriftskø");
    } catch (e) {
      toast.error("Kunne ikke legge i utskriftskø", { description: (e as Error).message });
    } finally {
      setPrintingReceipt(false);
    }
  };

  const handlePrintLabel = () => {
    toast.info("Skriv ut etikett: bygges i Steg 4 (etikett-skriver + produktvalg)");
  };

  // ── Map DB → render-types ──
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
    return data.buttons.map((b) => {
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
      const functionPath =
        (b.button_type === "function" || b.button_type === "function_code") && b.function_code
          ? data.functionImagePaths[b.function_code] ?? null
          : null;
      const resolvedPath = b.image_storage_path || productPath || functionPath;

      return {
        id: b.id,
        page_id: b.page_id,
        button_type: (b.button_type as RenderButton["button_type"]) ?? "function",
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
    const effRate = cart.effectiveMvaRate(it);
    return {
      id: it.id,
      label: it.product_snapshot.display_name,
      qty: it.quantity,
      unit: it.product_snapshot.unit ?? null,
      line_total:
        Math.round(
          (it.quantity * it.unit_price_excl_mva - it.line_discount) *
            (1 + effRate / 100) *
            100,
        ) / 100,
      image_url: signed ?? fallback ?? null,
      dining_mode: effectiveDining(it, cart.diningMode),
      is_food: isFoodItem(it),
      dining_overridden: it.dining_mode_override != null,
      mva_rate: effRate,
    };
  });


  const stubToast = (label: string) =>
    toast.info(`${label}: bygges senere`);

  const headerRight = (
    <>
      {sessionOpen && (
        <button
          type="button"
          onClick={() => setCloseSessionOpen(true)}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          style={{ color: "var(--kiosk-header-ink)" }}
        >
          <X className="h-3.5 w-3.5" /> Avslutt skift
        </button>
      )}
      {operator && (
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          style={{ color: "var(--kiosk-header-ink)" }}
        >
          <LogOut className="h-3.5 w-3.5" /> Logg av
        </button>
      )}
    </>
  );

  const handleFooterAction = useCallback(
    (code: string) => {
      switch (code) {
        case "discount":
          stubToast("Rabatt");
          return;
        case "label_print":
          handlePrintLabel();
          return;
        case "park_order":
          stubToast("Parker ordre");
          return;
        case "clear_order":
          setClearOpen(true);
          return;
        case "receipt":
          if (lastReceipt) setReceipt(lastReceipt);
          else toast.info("Ingen siste kvittering");
          return;
        case "customer":
          stubToast("Kunde");
          return;
        case "pickup_orders":
          setHenteordreOpen(true);
          return;
        case "kakebygger":
          setKakebyggerOpen(true);
          return;
        case "open_drawer":
          stubToast("Åpne kasseskuff");
          if (terminal?.id) {
            kioskSupabase
              .rpc("pos_journal_append", {
                p_terminal_id: terminal.id,
                p_event_type: "drawer_open",
                p_operator_id: operator?.id ?? null,
                p_session_id: session?.id ?? null,
                p_payload: { reason: "manual" },
              } as never)
              .then(({ error }) => {
                if (error) console.warn("pos_journal_append drawer_open failed", error.message);
              });
          }
          return;
        default:
          toast.info(`${code}: ikke koblet`);
      }
    },
    [lastReceipt, terminal?.id, operator?.id, session?.id],
  );

  const footerDisabled: Record<string, boolean> = {
    clear_order: cart.items.length === 0,
    receipt: !lastReceipt,
  };


  const diningForRender: "takeaway" | "eatin" | "pickup" = cart.diningMode;
  const handleDiningChange = (m: "takeaway" | "eatin" | "pickup") => {
    if (m === "pickup") {
      stubToast("Henteordre");
      return;
    }
    cart.setDiningMode(m);
  };

  return (
    <div className="flex h-screen w-screen flex-col">
      {loading ? (
        <div className="flex flex-1 items-center justify-center bg-[var(--kiosk-bg)] text-[var(--kiosk-ink)]" style={{ ...({ ["--kiosk-bg" as string]: theme.bg, ["--kiosk-ink" as string]: theme.ink } as React.CSSProperties) }}>
          Laster tastatur…
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
          headerLabel={terminal?.display_name ?? "Kassen"}
          headerTerminalCode={terminal?.terminal_code ?? null}
          headerOperatorName={operator?.display_name ?? null}
          headerRight={headerRight}
          interactive
          onButtonClick={handleButtonClick}
          onPay={() => {
            if (cart.items.length === 0) return;
            setRpcError(null);
            setPayOpen(true);
          }}
          onClear={() => setClearOpen(true)}
          onCartLineQtyChange={(id, delta) => {
            const it = cart.items.find((x) => x.id === id);
            if (!it) return;
            const next = it.quantity + delta;
            if (next <= 0) cart.removeItem(id);
            else cart.updateQuantity(id, next);
          }}
          onCartLineRemove={(id) => cart.removeItem(id)}
          onCartLineDiningCycle={(id) => {
            const it = cart.items.find((x) => x.id === id);
            if (!it) return;
            const cur = it.dining_mode_override;
            const next =
              cur == null ? "eatin" : cur === "eatin" ? "takeaway" : null;
            cart.setLineDiningOverride(id, next);
          }}
          diningMode={diningForRender}
          onDiningChange={handleDiningChange}
          onFooterAction={handleFooterAction}
          footerActionDisabled={footerDisabled}
          emptyState={
            <div>
              <p className="text-lg font-medium" style={{ color: "var(--kiosk-ink)" }}>
                {data ? "Ingen knapper på denne siden" : "Ingen tastatur konfigurert"}
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--kiosk-ink-soft)" }}>
                {data
                  ? "Konfigurer i POS Styring → Tastatur."
                  : "Bind en layout til terminalen eller sett en default på selskapet."}
              </p>
            </div>
          }
        />
      )}

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
        terminalId={terminal?.id ?? null}
        operatorCode={operator?.code ?? null}
        company={receiptHeader.company}
        outlet={receiptHeader.outlet}
        onNewSale={handleNewSale}
        onPrintReceipt={handlePrintReceipt}
        printingReceipt={printingReceipt}
      />

      {sessionOpen && (
        <CloseSessionModal
          open={closeSessionOpen}
          onOpenChange={setCloseSessionOpen}
          sessionId={session.id}
          openingFloat={Number(session.opening_float ?? 0)}
          onClosed={() => {
            setCloseSessionOpen(false);
            logout();
          }}
        />
      )}
      <KakebyggerModal
        open={kakebyggerOpen}
        onOpenChange={setKakebyggerOpen}
        legalEntityId={operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null}
        priceListId={priceListId}
        defaultPickupLocationId={terminal?.outlet_id ?? null}
        onCakeComplete={async (result) => {
          const leId = operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;
          if (!leId) {
            toast.error("Mangler legal entity for terminalen");
            return;
          }
          try {
            const { data, error } = await kioskSupabase.rpc(
              "pos_create_cake_order" as never,
              {
                p_payload: {
                  legal_entity_id: leId,
                  pickup_location_id:
                    result.customer_meta?.pickup_location_id ?? terminal?.outlet_id ?? null,
                  pickup_date: result.customer_meta?.pickup_date,
                  customer_name: result.customer_meta?.name,
                  customer_phone: result.customer_meta?.phone,
                  customer_email: result.customer_meta?.email,
                  payment_mode: result.payment_mode ?? "later",
                  cake_result: result,
                },
              } as never,
            );
            if (error) throw error;
            const created = data as unknown as {
              order_number: string;
              order_id: string;
              cake_result?: typeof result;
            };
            const serverResult = created.cake_result ?? result;
            toast.success(`Henteordre #${created.order_number} opprettet`);
            if (result.payment_mode === "now") {
              setActivePickupOrderId(created.order_id);
              cart.addItem({
                product_id: serverResult.order_line.product_id,
                product_snapshot: {
                  display_name: serverResult.order_line.display_name,
                  display_number: String(serverResult.order_line.display_number ?? ""),
                  unit: "stk",
                  mva_rate: serverResult.order_line.vat_rate,
                },
                quantity: serverResult.order_line.quantity,
                unit_price_excl_mva: serverResult.order_line.unit_price_excl_vat,
                base_mva_rate: serverResult.order_line.vat_rate,
                eatin_mva_rate: null,
              });
              for (const acc of serverResult.accessory_lines) {
                cart.addItem({
                  product_id: acc.product_id,
                  product_snapshot: {
                    display_name: acc.display_name,
                    display_number: String(acc.display_number ?? ""),
                    unit: "stk",
                    mva_rate: acc.vat_rate,
                  },
                  quantity: acc.quantity,
                  unit_price_excl_mva: acc.unit_price_excl_vat,
                  base_mva_rate: acc.vat_rate,
                  eatin_mva_rate: null,
                });
              }
            }
          } catch (e) {
            toast.error("Kunne ikke opprette henteordre", { description: (e as Error).message });
          }
        }}
      />
      <HenteordreModal
        open={henteordreOpen}
        onOpenChange={setHenteordreOpen}
        legalEntityId={operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null}
        pickupLocationId={terminal?.outlet_id ?? null}
        onLoadOrder={(order, lines) => {
          setActivePickupOrderId(order.id);
          for (const l of lines) {
            cart.addItem({
              product_id: l.product_id,
              product_snapshot: {
                display_name: l.product_snapshot?.display_name ?? "Henteordre-linje",
                display_number: "",
                unit: l.product_snapshot?.unit ?? "stk",
                mva_rate: l.mva_rate,
              },
              quantity: l.quantity,
              unit_price_excl_mva: l.unit_price_excl_mva,
              base_mva_rate: l.mva_rate,
              eatin_mva_rate: null,
            });
          }
          toast.success(`Henteordre #${order.order_number} lastet inn i kurv`);
        }}
      />

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette ordre?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle linjer fjernes. Dette kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cart.clear();
                setClearOpen(false);
              }}
            >
              Slett ordre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


