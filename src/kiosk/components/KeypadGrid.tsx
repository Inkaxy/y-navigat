import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import type {
  KeypadButton,
  KeypadData,
} from "@/kiosk/hooks/useKeypadLayout";
import { useKeypadNav } from "@/kiosk/context/KeypadNavContext";
import { useCart } from "@/kiosk/context/CartContext";
import {
  usePriceListConfig,
  useProductLookup,
} from "@/kiosk/hooks/useProductLookup";
import { useTerminal } from "@/kiosk/context/TerminalContext";
import { useOperator } from "@/kiosk/context/OperatorContext";
import { KakebyggerModal } from "@/kiosk/components/KakebyggerModal";
import { cn } from "@/lib/utils";

interface Props {
  data: NonNullable<KeypadData>;
}

export function KeypadGrid({ data }: Props) {
  const { layout, pages, buttons, imageUrls } = data;
  const { terminal } = useTerminal();
  const { operator } = useOperator();
  const nav = useKeypadNav();
  const { addItem } = useCart();
  const [kakebyggerOpen, setKakebyggerOpen] = useState(false);
  const priceListId = terminal?.default_price_list_id ?? null;
  const { data: priceListCfg } = usePriceListConfig(priceListId);
  const lookupProduct = useProductLookup(
    priceListId,
    priceListCfg?.prices_include_mva ?? false,
  );

  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.sort_order - b.sort_order),
    [pages],
  );
  const currentPageId = nav.currentPageId ?? sortedPages[0]?.id ?? null;
  const currentPage = sortedPages.find((p) => p.id === currentPageId);
  const pageButtons = useMemo(
    () => buttons.filter((b) => b.page_id === currentPageId),
    [buttons, currentPageId],
  );

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
        toast.error(
          `${b.display_label ?? "Produkt"}: mangler pris i prisliste`,
        );
        return;
      }
      addItem({
        product_id: p.id,
        product_snapshot: {
          display_name: p.display_name,
          display_number: String(p.display_number),
          unit: p.unit_of_sale,
          mva_rate: p.mva_rate,
        },
        unit_price_excl_mva: p.unit_price_excl_mva,
        mva_rate: p.mva_rate,
        quantity: 1,
      });
    } catch (e) {
      toast.error("Feil ved produkt-oppslag", {
        description: (e as Error).message,
      });
    }
  };

  const handleCategory = (b: KeypadButton) => {
    const label = (b.display_label ?? "").trim().toLowerCase();
    if (!label) {
      toast.warning("Kategori-knapp uten etikett");
      return;
    }
    const target = sortedPages.find(
      (p) => p.page_name.trim().toLowerCase() === label,
    );
    if (target) {
      nav.navigateTo(target.id);
    } else {
      toast.warning(
        `${b.display_label}: underside ikke konfigurert`,
      );
    }
  };

  const handleFunction = (b: KeypadButton) => {
    if (b.function_code === "kakebygger") {
      setKakebyggerOpen(true);
      return;
    }
    toast.info(
      `${b.display_label ?? b.function_code ?? "Funksjon"}: bygges senere`,
    );
  };

  const handleClick = (b: KeypadButton) => {
    switch (b.button_type) {
      case "product":
        void handleProduct(b);
        return;
      case "category":
        handleCategory(b);
        return;
      case "function":
      case "function_code":
        handleFunction(b);
        return;
      default:
        toast.info(`Knapp-type "${b.button_type}" ikke støttet ennå`);
    }
  };

  const kbLegalEntityId =
    operator?.legal_entity_id ?? terminal?.legal_entity_id ?? null;

  return (
    <>
    <div className="flex h-full flex-col gap-3">
      {nav.canGoBack ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav.goBack()}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-[#F4ECDC] hover:bg-white/10 active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" /> Tilbake
          </button>
          <span className="text-sm text-[#F4ECDC]/60">
            {currentPage?.page_name}
          </span>
        </div>
      ) : (
        sortedPages.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {sortedPages.map((p) => (
              <button
                key={p.id}
                onClick={() => nav.replaceTo(p.id)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  p.id === currentPageId
                    ? "bg-amber-500 text-[#1B1410]"
                    : "bg-white/5 text-[#F4ECDC]/70 hover:bg-white/10",
                )}
              >
                {p.page_name}
              </button>
            ))}
          </div>
        )
      )}

      {pageButtons.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
          <div>
            <p className="text-lg font-medium text-[#F4ECDC]/80">
              Ingen knapper på denne siden
            </p>
            <p className="mt-2 text-sm text-[#F4ECDC]/50">
              Konfigurer tastatur i POS Styring → Tastatur.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="grid flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${layout.grid_cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.grid_rows}, minmax(72px, 1fr))`,
          }}
        >
          {pageButtons.map((b) => (
            <button
              key={b.id}
              onClick={() => handleClick(b)}
              className="flex flex-col items-center justify-center rounded-xl border border-white/5 p-2 text-center transition-all active:scale-[0.97]"
              style={{
                gridColumn: `${b.grid_x + 1} / span ${b.grid_width || 1}`,
                gridRow: `${b.grid_y + 1} / span ${b.grid_height || 1}`,
                backgroundColor: b.background_color ?? "rgba(255,255,255,0.06)",
                color: b.text_color ?? "#F4ECDC",
              }}
            >
              {b.image_url && (
                <img
                  src={b.image_url}
                  alt=""
                  className="mb-1 max-h-12 max-w-full object-contain"
                  draggable={false}
                />
              )}
              <span className="text-sm font-semibold leading-tight">
                {b.display_label ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
    <KakebyggerModal
      open={kakebyggerOpen}
      onOpenChange={setKakebyggerOpen}
      legalEntityId={kbLegalEntityId}
      priceListId={priceListId}
    />
    </>
  );
}
