// Felles presentasjonslag for kiosken. Lever av theme-CSS-variabler
// satt av themeToVars. Brukes av live-preview i TastaturEditor og
// av selve kasse-skjermen. INGEN hardkodede farger her — kun var(--kiosk-*).

import {
  ChevronLeft,
  Minus,
  Plus as PlusIcon,
  ShoppingBag,
  ShoppingCart,
  Utensils,
  X as XIcon,
} from "lucide-react";
import { getLucideIcon } from "@/lib/appIcons";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { FooterAction, KioskTheme } from "./kioskTheme";
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
  image_url?: string | null;
  /** Effektiv serveringsmodus for linjen (etter override). */
  dining_mode?: "takeaway" | "eatin";
  /** Sant hvis dining-mode kan veksles (matvare). */
  is_food?: boolean;
  /** Sant hvis modus er eksplisitt overstyrt (avviker fra kurv-default). */
  dining_overridden?: boolean;
  /** Effektiv MVA-sats for visning. */
  mva_rate?: number;
}

type DiningMode = "takeaway" | "eatin" | "pickup";

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
  onCartLineQtyChange?: (id: string, delta: number) => void;
  onCartLineRemove?: (id: string) => void;
  onCartLineDiningCycle?: (id: string) => void;
  diningMode?: DiningMode;
  onDiningChange?: (m: DiningMode) => void;
  // Handlingslinje: code → handler. Hvis ikke gitt, brukes ingen footer.
  onFooterAction?: (code: string) => void;
  footerActionDisabled?: Partial<Record<string, boolean>>;
  // Bakoverkompat: hvis satt, overstyrer dette footerActions fra temaet
  footerSlot?: ReactNode;
  // Tom-tilstand når ingen knapper finnes
  emptyState?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function IconByName({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null;
  const Comp = getLucideIcon(name);
  if (!Comp) return null;
  return <Comp className={className} />;
}

// ── Brand-header ─────────────────────────────────────────────────────────────
function BrandMark({ url, fallbackLetter, size = 44 }: { url: string | null; fallbackLetter: string; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="object-contain"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        background: "var(--kiosk-accent-soft)",
        color: "var(--kiosk-accent)",
        fontFamily: "var(--kiosk-font-heading)",
        fontSize: size * 0.42,
        letterSpacing: "0.02em",
      }}
    >
      {fallbackLetter}
    </div>
  );
}

function MinimalHeader({
  label,
  terminalCode,
  operatorName,
  right,
}: {
  label: string;
  terminalCode?: string | null;
  operatorName?: string | null;
  right?: ReactNode;
}) {
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
        <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-60">
          {terminalCode ?? "—"}
        </span>
        <span className="text-sm opacity-80">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {operatorName && <span className="text-xs opacity-70">{operatorName}</span>}
        {right}
      </div>
    </header>
  );
}

function BrandedLeftHeader({
  theme,
  operatorName,
  terminalCode,
  right,
}: {
  theme: KioskTheme;
  operatorName?: string | null;
  terminalCode?: string | null;
  right?: ReactNode;
}) {
  const letter = (theme.brandName?.trim()[0] ?? "B").toUpperCase();
  return (
    <header
      className="flex items-center justify-between gap-6 px-6 py-4"
      style={{
        background: "var(--kiosk-header-bg)",
        color: "var(--kiosk-header-ink)",
        borderBottom: "1px solid var(--kiosk-border)",
        fontFamily: "var(--kiosk-font-heading)",
      }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <BrandMark url={theme.brandLogoUrl} fallbackLetter={letter} size={52} />
        <div className="min-w-0">
          <div
            className="truncate text-xl font-semibold uppercase"
            style={{ letterSpacing: "0.08em" }}
          >
            {theme.brandName ?? "Kassen"}
          </div>
          {theme.brandTagline && (
            <div className="truncate text-[11px] uppercase opacity-70" style={{ letterSpacing: "0.18em" }}>
              {theme.brandTagline}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {operatorName && (
          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span className="opacity-60 text-[10px] uppercase tracking-widest">Kassør</span>
            <span className="font-semibold">{operatorName}</span>
          </div>
        )}
        {terminalCode && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
            {terminalCode}
          </span>
        )}
        {right}
      </div>
    </header>
  );
}

function BrandedCenteredHeader({
  theme,
  operatorName,
  right,
}: {
  theme: KioskTheme;
  operatorName?: string | null;
  right?: ReactNode;
}) {
  const letter = (theme.brandName?.trim()[0] ?? "B").toUpperCase();
  return (
    <header
      className="flex items-center justify-between gap-6 px-8 py-5"
      style={{
        background: "var(--kiosk-header-bg)",
        color: "var(--kiosk-header-ink)",
        borderBottom: "1px solid var(--kiosk-border)",
        fontFamily: "var(--kiosk-font-heading)",
      }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <BrandMark url={theme.brandLogoUrl} fallbackLetter={letter} size={56} />
        <div className="min-w-0">
          <div
            className="truncate text-2xl font-semibold uppercase leading-none"
            style={{ letterSpacing: "0.1em" }}
          >
            {theme.brandName ?? "Kassen"}
          </div>
          {theme.brandTagline && (
            <div
              className="mt-1 truncate text-[11px] uppercase opacity-70"
              style={{ letterSpacing: "0.28em" }}
            >
              {theme.brandTagline}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {operatorName && (
          <span className="hidden text-xs opacity-70 sm:inline">{operatorName}</span>
        )}
        {theme.brandMonogramUrl ? (
          <img
            src={theme.brandMonogramUrl}
            alt=""
            className="hidden h-10 w-10 object-contain opacity-90 sm:block"
            draggable={false}
          />
        ) : null}
        {right}
      </div>
    </header>
  );
}

function KioskHeader({
  theme,
  label,
  terminalCode,
  operatorName,
  right,
}: {
  theme: KioskTheme;
  label: string;
  terminalCode?: string | null;
  operatorName?: string | null;
  right?: ReactNode;
}) {
  switch (theme.headerStyle) {
    case "branded_left":
      return (
        <BrandedLeftHeader
          theme={theme}
          terminalCode={terminalCode}
          operatorName={operatorName}
          right={right}
        />
      );
    case "branded_centered":
      return <BrandedCenteredHeader theme={theme} operatorName={operatorName} right={right} />;
    case "minimal":
    default:
      return (
        <MinimalHeader
          label={label}
          terminalCode={terminalCode}
          operatorName={operatorName}
          right={right}
        />
      );
  }
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

// ── Dining pills ─────────────────────────────────────────────────────────────
const DINING_META: Record<DiningMode, { label: string; sub: string; icon: ReactNode }> = {
  eatin: { label: "Sitt her", sub: "Spis hos oss", icon: <Utensils className="h-5 w-5" /> },
  takeaway: { label: "Ta med", sub: "Take away", icon: <ShoppingBag className="h-5 w-5" /> },
  pickup: { label: "Henteordre", sub: "Forhåndsbestilt", icon: <ShoppingCart className="h-5 w-5" /> },
};

function HeroDiningPills({
  mode,
  onChange,
  style,
}: {
  mode: DiningMode;
  onChange: (m: DiningMode) => void;
  style: "soft" | "outlined" | "solid";
}) {
  const opts: DiningMode[] = ["eatin", "takeaway", "pickup"];
  return (
    <div
      className="grid gap-3 px-3 pt-3"
      style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}
    >
      {opts.map((id) => {
        const meta = DINING_META[id];
        const active = mode === id;
        const bg = active
          ? style === "solid"
            ? "var(--kiosk-accent)"
            : "var(--kiosk-accent-soft)"
          : "var(--kiosk-surface)";
        const fg = active && style === "solid" ? "var(--kiosk-ink-on-accent)" : "var(--kiosk-ink)";
        const borderColor = active ? "var(--kiosk-accent)" : "var(--kiosk-border)";
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className="flex items-center gap-3 border px-5 py-3 text-left transition-all active:scale-[0.98]"
            style={{
              borderRadius: "var(--kiosk-radius)",
              background: bg,
              color: fg,
              borderColor,
              borderWidth: style === "outlined" || active ? 2 : 1,
              fontFamily: "var(--kiosk-font-body)",
            }}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{
                background: active && style !== "solid" ? "var(--kiosk-surface)" : "transparent",
                color: active && style === "solid" ? "var(--kiosk-ink-on-accent)" : "var(--kiosk-accent)",
              }}
            >
              {meta.icon}
            </span>
            <span className="flex flex-col leading-tight">
              <span
                className="text-base font-semibold uppercase"
                style={{ letterSpacing: "0.05em" }}
              >
                {meta.label}
              </span>
              <span className="text-xs opacity-70">{meta.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DiningChip({
  mode,
  onChange,
}: {
  mode: DiningMode;
  onChange: (m: DiningMode) => void;
}) {
  const opts: DiningMode[] = ["eatin", "takeaway", "pickup"];
  return (
    <div
      className="flex gap-1 rounded-md p-1 text-xs"
      style={{
        background: "var(--kiosk-surface-alt)",
        border: "1px solid var(--kiosk-border)",
      }}
    >
      {opts.map((id) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className="rounded px-3 py-1.5 text-xs transition-colors"
            style={{
              background: active ? "var(--kiosk-accent)" : "transparent",
              color: active ? "var(--kiosk-ink-on-accent)" : "var(--kiosk-ink-soft)",
              fontFamily: "var(--kiosk-font-body)",
              fontWeight: active ? 700 : 500,
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.18)" : undefined,
              minHeight: 32,
            }}
          >
            {DINING_META[id].label}
          </button>
        );
      })}
    </div>
  );
}

// ── Keypad ───────────────────────────────────────────────────────────────────
function KeypadCell({
  b,
  interactive,
  onClick,
}: {
  b: RenderButton;
  interactive: boolean;
  onClick?: () => void;
}) {
  const hasImage = !!b.image_url;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={cn(
        "relative flex flex-col overflow-hidden border text-center text-sm font-semibold transition-transform active:scale-[0.97]",
        hasImage ? "items-stretch justify-end" : "items-center justify-center p-2",
      )}
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
      {hasImage && (
        <img src={b.image_url!} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      )}
      <span
        className={cn("relative z-10 leading-tight", hasImage && "w-full px-2 py-2")}
        style={hasImage ? { background: "var(--kiosk-surface)" } : undefined}
      >
        {b.display_label || "—"}
      </span>
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

// ── Cart ─────────────────────────────────────────────────────────────────────
function CartLineCompact({ line }: { line: RenderCartLine }) {
  return (
    <div
      className="flex items-center justify-between border-b py-2 text-sm last:border-0"
      style={{ borderColor: "var(--kiosk-border)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{line.label}</div>
        <div className="text-xs opacity-60">
          {line.qty}
          {line.unit ? ` ${line.unit}` : ""}
        </div>
      </div>
      <div className="ml-3 tabular-nums font-semibold">{line.line_total.toFixed(2)}</div>
    </div>
  );
}

function CartLineRich({
  line,
  showImage,
  showStepper,
  onQtyChange,
  onRemove,
  onDiningCycle,
}: {
  line: RenderCartLine;
  showImage: boolean;
  showStepper: boolean;
  onQtyChange?: (id: string, delta: number) => void;
  onRemove?: (id: string) => void;
  onDiningCycle?: (id: string) => void;
}) {
  const showDiningPill = line.is_food && onDiningCycle;
  const modeLabel = line.dining_mode === "eatin" ? "Sitt her" : "Ta med";
  return (
    <div
      className="flex items-center gap-3 border-b py-2 last:border-0"
      style={{ borderColor: "var(--kiosk-border)" }}
    >
      {showImage && (
        <div
          className="h-12 w-12 shrink-0 overflow-hidden"
          style={{ borderRadius: "calc(var(--kiosk-radius) - 2px)", background: "var(--kiosk-surface-alt)" }}
        >
          {line.image_url ? (
            <img src={line.image_url} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : null}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">{line.label}</span>
          <span className="tabular-nums text-sm font-semibold">{line.line_total.toFixed(0)},-</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] opacity-60">
          {line.mva_rate != null && <span>{line.mva_rate}%</span>}
          {line.dining_mode && <span>· {modeLabel}</span>}
          {line.dining_overridden && <span className="text-amber-500">✱</span>}
        </div>
        {showStepper ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onQtyChange?.(line.id, -1)}
              className="flex h-7 w-7 items-center justify-center border transition-colors hover:bg-[color:var(--kiosk-surface-alt)]"
              style={{ borderRadius: "calc(var(--kiosk-radius) - 4px)", borderColor: "var(--kiosk-border)" }}
              aria-label="Reduser"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[1.5rem] text-center tabular-nums text-sm font-semibold">
              {line.qty}
            </span>
            <button
              type="button"
              onClick={() => onQtyChange?.(line.id, 1)}
              className="flex h-7 w-7 items-center justify-center border transition-colors hover:bg-[color:var(--kiosk-surface-alt)]"
              style={{ borderRadius: "calc(var(--kiosk-radius) - 4px)", borderColor: "var(--kiosk-border)" }}
              aria-label="Øk"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
            {showDiningPill && (
              <button
                type="button"
                onClick={() => onDiningCycle(line.id)}
                className={
                  "ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors " +
                  (line.dining_overridden
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-200"
                    : "border-transparent bg-[color:var(--kiosk-surface-alt)] opacity-70 hover:opacity-100")
                }
                aria-label="Bytt serveringsmodus for linjen"
                title="Bytt mellom Sitt her / Ta med for denne varen"
              >
                {modeLabel}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(line.id)}
                className="ml-auto flex h-7 w-7 items-center justify-center opacity-50 hover:opacity-100"
                aria-label="Fjern"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs opacity-60">
            {line.qty}
            {line.unit ? ` ${line.unit}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function CartPane({
  theme,
  cart,
  total,
  onPay,
  onClear,
  payDisabled,
  diningMode,
  onDiningChange,
  onCartLineQtyChange,
  onCartLineRemove,
  onCartLineDiningCycle,
}: {
  theme: KioskTheme;
  cart: RenderCartLine[];
  total: number;
  onPay?: () => void;
  onClear?: () => void;
  payDisabled?: boolean;
  diningMode?: DiningMode;
  onDiningChange?: (m: DiningMode) => void;
  onCartLineQtyChange?: (id: string, delta: number) => void;
  onCartLineRemove?: (id: string) => void;
  onCartLineDiningCycle?: (id: string) => void;
}) {
  const rich = theme.cartStyle === "rich";
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider opacity-70">
          <ShoppingCart className="h-4 w-4" />
          Kurv · {cart.length}
        </div>
        {diningMode && onDiningChange && theme.diningPlacement === "cart_chip" && (
          <DiningChip mode={diningMode} onChange={onDiningChange} />
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm opacity-50">
            Trykk på et produkt for å legge til
          </div>
        ) : rich ? (
          cart.map((l) => (
            <CartLineRich
              key={l.id}
              line={l}
              showImage={theme.cartShowImages}
              showStepper={theme.cartShowStepper}
              onQtyChange={onCartLineQtyChange}
              onRemove={onCartLineRemove}
              onDiningCycle={onCartLineDiningCycle}
            />
          ))
        ) : (
          cart.map((l) => <CartLineCompact key={l.id} line={l} />)
        )}
      </div>
      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--kiosk-border)" }}
      >
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70"
            style={{ fontFamily: "var(--kiosk-font-heading)" }}
          >
            Totalt
          </span>
          <span
            className="tabular-nums text-3xl font-bold leading-none"
            style={{ fontFamily: "var(--kiosk-font-heading)" }}
          >
            {total.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!onClear || cart.length === 0}
          onClick={onClear}
          className="flex-1 px-3 py-4 text-sm font-semibold disabled:opacity-40"
          style={{
            borderRadius: "var(--kiosk-radius)",
            background: "var(--kiosk-surface-alt)",
            color: "var(--kiosk-ink-soft)",
            fontFamily: "var(--kiosk-font-body)",
            minHeight: 56,
          }}
        >
          Tøm
        </button>
        <button
          type="button"
          disabled={!onPay || payDisabled || cart.length === 0}
          onClick={onPay}
          className="flex flex-[2] flex-col items-center justify-center px-3 py-4 transition-transform active:scale-[0.98] disabled:opacity-40"
          style={{
            borderRadius: "var(--kiosk-radius)",
            background: "var(--kiosk-accent)",
            color: "var(--kiosk-ink-on-accent)",
            fontFamily: "var(--kiosk-font-heading)",
            minHeight: 64,
          }}
        >
          <span className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80 leading-none">
            Betal
          </span>
          <span className="mt-1 text-2xl font-bold leading-none tabular-nums">
            kr {total.toFixed(2)}
          </span>
        </button>
      </div>
    </aside>
  );
}

// ── Footer action bar ────────────────────────────────────────────────────────
function FooterActionBar({
  actions,
  style,
  onAction,
  disabled,
}: {
  actions: FooterAction[];
  style: "pill_grid" | "icon_card" | "compact_row";
  onAction: (code: string) => void;
  disabled?: Partial<Record<string, boolean>>;
}) {
  if (!actions.length) return null;
  if (style === "icon_card") {
    return (
      <div
        className="grid gap-2 px-3 py-3"
        style={{
          gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))`,
          background: "var(--kiosk-surface)",
          borderTop: "1px solid var(--kiosk-border)",
        }}
      >
        {actions.map((a) => {
          const isDanger = a.variant === "danger";
          const isDisabled = !!disabled?.[a.code];
          return (
            <button
              key={a.code}
              type="button"
              disabled={isDisabled}
              onClick={() => onAction(a.code)}
              className="flex items-center gap-3 border px-4 py-3 transition-colors disabled:opacity-40 active:scale-[0.98]"
              style={{
                borderRadius: "var(--kiosk-radius)",
                borderColor: "var(--kiosk-border)",
                background: "var(--kiosk-surface)",
                color: isDanger ? "#B23A48" : "var(--kiosk-ink)",
                fontFamily: "var(--kiosk-font-body)",
              }}
            >
              <IconByName name={a.icon} className="h-4 w-4 shrink-0" />
              <span
                className="truncate text-xs font-semibold uppercase"
                style={{ letterSpacing: "0.06em" }}
              >
                {a.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  if (style === "compact_row") {
    return (
      <div
        className="flex items-center gap-2 overflow-x-auto px-3 py-2"
        style={{
          background: "var(--kiosk-surface)",
          borderTop: "1px solid var(--kiosk-border)",
        }}
      >
        {actions.map((a) => {
          const isDanger = a.variant === "danger";
          const isDisabled = !!disabled?.[a.code];
          return (
            <button
              key={a.code}
              type="button"
              disabled={isDisabled}
              onClick={() => onAction(a.code)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                borderRadius: "calc(var(--kiosk-radius) - 2px)",
                borderColor: "var(--kiosk-border)",
                background: "var(--kiosk-surface)",
                color: isDanger ? "#B23A48" : "var(--kiosk-ink)",
                fontFamily: "var(--kiosk-font-body)",
              }}
            >
              <IconByName name={a.icon} className="h-3.5 w-3.5" />
              {a.label}
            </button>
          );
        })}
      </div>
    );
  }
  // pill_grid (default)
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-3"
      style={{
        background: "var(--kiosk-surface)",
        borderTop: "1px solid var(--kiosk-border)",
      }}
    >
      {actions.map((a) => {
        const isDanger = a.variant === "danger";
        const isDisabled = !!disabled?.[a.code];
        return (
          <button
            key={a.code}
            type="button"
            disabled={isDisabled}
            onClick={() => onAction(a.code)}
            className="inline-flex flex-1 items-center justify-center gap-2 border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 active:scale-[0.98]"
            style={{
              borderRadius: "var(--kiosk-radius)",
              borderColor: "var(--kiosk-border)",
              background: "var(--kiosk-surface)",
              color: isDanger ? "#B23A48" : "var(--kiosk-ink)",
              fontFamily: "var(--kiosk-font-body)",
              minWidth: "8rem",
            }}
          >
            <IconByName name={a.icon} className="h-4 w-4" />
            {a.label}
          </button>
        );
      })}
    </div>
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
  onBack,
  canGoBack,
  cart = [],
  total = 0,
  headerLabel = "Kassen",
  headerTerminalCode,
  headerOperatorName,
  headerRight,
  interactive = false,
  onButtonClick,
  onPay,
  onClear,
  payDisabled,
  onCartLineQtyChange,
  onCartLineRemove,
  onCartLineDiningCycle,
  diningMode,
  onDiningChange,
  onFooterAction,
  footerActionDisabled,
  footerSlot,
  emptyState,
  className,
  style,
}: Props): ReactNode {
  const sortedPages = [...pages].sort((a, b) => a.sort_order - b.sort_order);
  const activePageId = currentPageId ?? sortedPages[0]?.id ?? null;
  const activePage = sortedPages.find((p) => p.id === activePageId) ?? null;
  const pageButtons = buttons.filter((b) => b.page_id === activePageId);
  const isTabs = theme.layoutKind === "tabs_top";
  const showEmpty = !!emptyState && pageButtons.length === 0;
  const showHeroDining =
    theme.diningPlacement === "top_hero" && !!diningMode && !!onDiningChange;
  const showHeaderPills =
    theme.diningPlacement === "header_pills" && !!diningMode && !!onDiningChange;

  const headerRightCombined = (
    <>
      {showHeaderPills && diningMode && onDiningChange && (
        <DiningChip mode={diningMode} onChange={onDiningChange} />
      )}
      {headerRight}
    </>
  );

  return (
    <div
      className={cn("flex h-full w-full flex-col overflow-hidden", className)}
      style={{ ...themeToVars(theme), background: "var(--kiosk-bg)", ...style }}
    >
      <KioskHeader
        theme={theme}
        label={headerLabel}
        terminalCode={headerTerminalCode}
        operatorName={headerOperatorName}
        right={headerRightCombined}
      />
      {canGoBack && onBack && (
        <div
          className="flex items-center gap-3 border-b px-4 py-2"
          style={{ borderColor: "var(--kiosk-border)", background: "var(--kiosk-surface)" }}
        >
          <KioskBackButton onClick={onBack} />
          <span className="text-sm" style={{ color: "var(--kiosk-ink-soft)" }}>
            {activePage?.page_name}
          </span>
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1", isTabs && "flex-col")}>
        {!canGoBack && (
          <NavTabs
            pages={sortedPages}
            currentPageId={activePageId}
            onPageChange={onPageChange}
            variant={isTabs ? "tabs" : "sidebar"}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {showHeroDining && diningMode && onDiningChange && (
              <HeroDiningPills
                mode={diningMode}
                onChange={onDiningChange}
                style={theme.diningPillStyle}
              />
            )}
            {showEmpty ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                {emptyState}
              </div>
            ) : (
              <KeypadArea
                gridCols={gridCols}
                gridRows={gridRows}
                buttons={pageButtons}
                interactive={interactive}
                onButtonClick={onButtonClick}
                pageBg={activePage?.background_color}
              />
            )}
          </div>
          <CartPane
            theme={theme}
            cart={cart}
            total={total}
            onPay={onPay}
            onClear={onClear}
            payDisabled={payDisabled}
            diningMode={diningMode}
            onDiningChange={onDiningChange}
            onCartLineQtyChange={onCartLineQtyChange}
            onCartLineRemove={onCartLineRemove}
            onCartLineDiningCycle={onCartLineDiningCycle}
          />
        </div>
      </div>
      {footerSlot ? (
        <div
          className="border-t px-3 py-2"
          style={{ borderColor: "var(--kiosk-border)", background: "var(--kiosk-surface)" }}
        >
          {footerSlot}
        </div>
      ) : onFooterAction ? (
        <FooterActionBar
          actions={theme.footerActions}
          style={theme.footerStyle}
          onAction={onFooterAction}
          disabled={footerActionDisabled}
        />
      ) : null}
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
