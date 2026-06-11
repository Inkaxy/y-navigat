// Felles presentasjonslag for kiosk-rendringen. Lever av theme-CSS-variabler
// satt av themeToVars. Brukes av live-preview i TastaturEditor nå, og (Steg 4)
// av selve kasse-skjermen. INGEN hardkodede farger her — kun var(--kiosk-*).

import { ChevronLeft, ShoppingCart } from "lucide-react";
import { icons as LucideIcons } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { KioskTheme } from "./kioskTheme";
import { themeToVars } from "./kioskTheme";

// ── Types som matcher dB-strukturen, men er ren-data (ikke koblet til Supabase)
export interface RenderPage {
  id: string;
  page_name: string;
  sort_order: number;
  background_color: string | null;
  icon?: string | null;
}

export interface RenderButton {
  id: string;
  page_id: string;
  button_type: "product" | "category" | "function";
  display_label: string | null;
  image_url: string | null;
  background_color: string | null;
  text_color: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
}

export interface RenderCartLine {
  id: string;
  label: string;
  qty: number;
  unit?: string | null;
  line_total: number;
}

interface Props {
  theme: KioskTheme;
  gridCols: number;
  gridRows: number;
  pages: RenderPage[];
  buttons: RenderButton[];
  currentPageId: string | null;
  onPageChange?: (pageId: string) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  cart?: RenderCartLine[];
  total?: number;
  headerLabel?: string;
  headerTerminalCode?: string | null;
  headerOperatorName?: string | null;
  headerRight?: ReactNode;
  // Interaktivitet for editor-preview: knapper er ikke trykkbare.
  interactive?: boolean;
  onButtonClick?: (b: RenderButton) => void;
  // Kurv-handlinger
  onPay?: () => void;
  onClear?: () => void;
  payDisabled?: boolean;
  diningMode?: "takeaway" | "eatin" | "pickup";
  onDiningChange?: (m: "takeaway" | "eatin" | "pickup") => void;
  // Handlingslinje (under)
  footerSlot?: ReactNode;
  // Tom-tilstand når ingen knapper finnes
  emptyState?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function IconByName({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null;
  const Comp = (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[name];
  if (!Comp) return null;
  return <Comp className={className} />;
}

function KioskHeader({ label }: { label: string }) {
  return (
    <header
      className="flex items-center justify-between px-6 py-3"
      style={{
        background: "var(--kiosk-header-bg)",
        color: "var(--kiosk-header-ink)",
        borderBottom: "1px solid var(--kiosk-border)",
        fontFamily: "var(--kiosk-font-heading)",
      }}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-60">T-01</span>
        <span className="text-sm opacity-80">{label}</span>
      </div>
      <span className="text-xs opacity-60">Demo operatør</span>
    </header>
  );
}

function NavTabs({
  pages,
  currentPageId,
  onPageChange,
  variant,
}: {
  pages: RenderPage[];
  currentPageId: string | null;
  onPageChange?: (id: string) => void;
  variant: "tabs" | "sidebar";
}) {
  const isSidebar = variant === "sidebar";
  return (
    <nav
      className={cn(
        isSidebar
          ? "flex w-44 flex-col gap-1 border-r p-3"
          : "flex w-full gap-1 overflow-x-auto border-b px-4 py-2",
      )}
      style={{
        background: "var(--kiosk-surface)",
        borderColor: "var(--kiosk-border)",
      }}
    >
      {pages.map((p) => {
        const active = p.id === currentPageId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPageChange?.(p.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-semibold transition-colors",
              isSidebar ? "justify-start" : "justify-center",
            )}
            style={{
              borderRadius: "var(--kiosk-radius)",
              background: active ? "var(--kiosk-accent-soft)" : "transparent",
              color: active ? "var(--kiosk-accent)" : "var(--kiosk-ink-soft)",
              borderBottom: !isSidebar
                ? `2px solid ${active ? "var(--kiosk-accent)" : "transparent"}`
                : undefined,
              fontFamily: "var(--kiosk-font-body)",
            }}
          >
            <IconByName name={p.icon} className="h-4 w-4" />
            <span>{p.page_name}</span>
          </button>
        );
      })}
    </nav>
  );
}

function KeypadCell({
  b,
  interactive,
  onClick,
}: {
  b: RenderButton;
  interactive: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className="flex flex-col items-center justify-center overflow-hidden border p-2 text-center text-sm font-semibold transition-transform active:scale-[0.97]"
      style={{
        gridColumn: `${b.grid_x + 1} / span ${b.grid_width || 1}`,
        gridRow: `${b.grid_y + 1} / span ${b.grid_height || 1}`,
        borderRadius: "var(--kiosk-button-radius)",
        background: b.background_color ?? "var(--kiosk-surface)",
        color: b.text_color ?? "var(--kiosk-ink)",
        borderColor: "var(--kiosk-border)",
        fontFamily: "var(--kiosk-font-body)",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      {b.image_url && (
        <img src={b.image_url} alt="" className="mb-1 max-h-12 object-contain" draggable={false} />
      )}
      <span className="leading-tight">{b.display_label || "—"}</span>
    </button>
  );
}

function KeypadArea({
  gridCols,
  gridRows,
  buttons,
  interactive,
  onButtonClick,
  pageBg,
}: {
  gridCols: number;
  gridRows: number;
  buttons: RenderButton[];
  interactive: boolean;
  onButtonClick?: (b: RenderButton) => void;
  pageBg?: string | null;
}) {
  return (
    <div
      className="grid flex-1 gap-2 p-3"
      style={{
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
        background: pageBg ?? "var(--kiosk-bg)",
        color: "var(--kiosk-ink)",
        fontFamily: "var(--kiosk-font-body)",
      }}
    >
      {buttons.map((b) => (
        <KeypadCell
          key={b.id}
          b={b}
          interactive={interactive}
          onClick={onButtonClick ? () => onButtonClick(b) : undefined}
        />
      ))}
    </div>
  );
}

function CartPane({
  cart,
  total,
}: {
  cart: RenderCartLine[];
  total: number;
}) {
  return (
    <aside
      className="flex w-80 flex-col gap-3 border-l p-4"
      style={{
        background: "var(--kiosk-cart-bg)",
        color: "var(--kiosk-cart-ink)",
        borderColor: "var(--kiosk-border)",
        fontFamily: "var(--kiosk-font-body)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider opacity-70">
          <ShoppingCart className="h-4 w-4" />
          Kurv · {cart.length}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm opacity-50">
            Trykk på et produkt for å legge til
          </div>
        ) : (
          cart.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between border-b py-2 text-sm last:border-0"
              style={{ borderColor: "var(--kiosk-border)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.label}</div>
                <div className="text-xs opacity-60">
                  {l.qty}
                  {l.unit ? ` ${l.unit}` : ""}
                </div>
              </div>
              <div className="ml-3 tabular-nums font-semibold">{l.line_total.toFixed(2)}</div>
            </div>
          ))
        )}
      </div>
      <div
        className="flex items-center justify-between border-t pt-3 text-lg font-bold"
        style={{ borderColor: "var(--kiosk-border)" }}
      >
        <span>Totalt</span>
        <span className="tabular-nums">{total.toFixed(2)}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled
          className="flex-1 px-3 py-3 text-sm font-semibold"
          style={{
            borderRadius: "var(--kiosk-radius)",
            background: "var(--kiosk-surface-alt)",
            color: "var(--kiosk-ink-soft)",
            fontFamily: "var(--kiosk-font-body)",
          }}
        >
          Tøm
        </button>
        <button
          type="button"
          disabled
          className="flex-[2] px-3 py-3 text-base font-bold"
          style={{
            borderRadius: "var(--kiosk-radius)",
            background: "var(--kiosk-accent)",
            color: "var(--kiosk-ink-on-accent)",
            fontFamily: "var(--kiosk-font-heading)",
          }}
        >
          Betal
        </button>
      </div>
    </aside>
  );
}

export function KioskRender({
  theme,
  gridCols,
  gridRows,
  pages,
  buttons,
  currentPageId,
  onPageChange,
  cart = [],
  total = 0,
  headerLabel = "Kassen",
  interactive = false,
  onButtonClick,
  className,
  style,
}: Props): ReactNode {
  const sortedPages = [...pages].sort((a, b) => a.sort_order - b.sort_order);
  const activePageId = currentPageId ?? sortedPages[0]?.id ?? null;
  const activePage = sortedPages.find((p) => p.id === activePageId) ?? null;
  const pageButtons = buttons.filter((b) => b.page_id === activePageId);
  const isTabs = theme.layoutKind === "tabs_top";

  return (
    <div
      className={cn("flex h-full w-full flex-col overflow-hidden", className)}
      style={{ ...themeToVars(theme), background: "var(--kiosk-bg)", ...style }}
    >
      <KioskHeader label={headerLabel} />
      <div className={cn("flex min-h-0 flex-1", isTabs && "flex-col")}>
        <NavTabs
          pages={sortedPages}
          currentPageId={activePageId}
          onPageChange={onPageChange}
          variant={isTabs ? "tabs" : "sidebar"}
        />
        <div className="flex min-h-0 flex-1">
          <KeypadArea
            gridCols={gridCols}
            gridRows={gridRows}
            buttons={pageButtons}
            interactive={interactive}
            onButtonClick={onButtonClick}
            pageBg={activePage?.background_color}
          />
          <CartPane cart={cart} total={total} />
        </div>
      </div>
    </div>
  );
}

export function KioskBackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-2 text-sm font-medium"
      style={{
        borderRadius: "var(--kiosk-radius)",
        background: "var(--kiosk-surface)",
        color: "var(--kiosk-ink)",
        fontFamily: "var(--kiosk-font-body)",
      }}
    >
      <ChevronLeft className="h-4 w-4" /> {label ?? "Tilbake"}
    </button>
  );
}
