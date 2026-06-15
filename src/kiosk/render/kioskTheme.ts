// Felles theme-modell for kiosken. Lever som jsonb på pos_keypad_layouts.theme
// og pos_keypad_layouts.customer_screen. Brukes av preview (TastaturEditor) OG
// av selve kiosk-rendringen.
//
// Alle nye felter er valgfrie i jsonb — parseTheme fyller dem fra DEFAULT_THEME
// så gamle layouts fortsatt rendrer identisk som før.

import type { CSSProperties } from "react";

export type KioskLayoutKind = "tabs_top" | "sidebar_left";

export type HeaderStyle = "minimal" | "branded_left" | "branded_centered";
export type DiningPlacement = "cart_chip" | "top_hero" | "header_pills";
export type DiningPillStyle = "soft" | "outlined" | "solid";
export type CartStyle = "compact" | "rich";
export type FooterStyle = "pill_grid" | "icon_card" | "compact_row";

// Tilgjengelige footer-handlinger. Kasse.tsx mapper code → handler.
export const FOOTER_ACTION_CODES = [
  "discount",
  "label_print",
  "park_order",
  "clear_order",
  "receipt",
  "customer",
  "pickup_orders",
  "kakebygger",
  "open_drawer",
] as const;
export type FooterActionCode = (typeof FOOTER_ACTION_CODES)[number];

export interface FooterAction {
  code: FooterActionCode;
  label: string;
  icon: string; // lucide-react ikon-navn
  variant?: "default" | "danger";
}

export interface KioskTheme {
  layoutKind: KioskLayoutKind;
  // Surfaces
  bg: string;          // canvas bak alt
  surface: string;     // kort / panel
  surfaceAlt: string;  // hover / aktiv tab
  border: string;
  // Text
  ink: string;
  inkSoft: string;
  inkOnAccent: string;
  // Accent
  accent: string;
  accentSoft: string;
  // Typo
  fontHeading: string;
  fontBody: string;
  // Geometry
  radius: string;
  buttonRadius: string;
  // Header
  headerBg: string;
  headerInk: string;
  // Cart
  cartBg: string;
  cartInk: string;
  // ── Brand (alle valgfrie) ──────────────────────────────────────────────
  brandName: string | null;
  brandTagline: string | null;     // "ETAB. 1879", "Sandefjord 1951"
  brandLogoUrl: string | null;
  brandMonogramUrl: string | null; // valgfri sekundær mark (mascot/seal)
  // ── Layout-varianter ───────────────────────────────────────────────────
  headerStyle: HeaderStyle;
  diningPlacement: DiningPlacement;
  diningPillStyle: DiningPillStyle;
  cartStyle: CartStyle;
  cartShowImages: boolean;
  cartShowStepper: boolean;
  footerStyle: FooterStyle;
  footerActions: FooterAction[];
}

export interface CustomerScreenConfig {
  mode: "logo_only" | "logo_and_cart";
  bg: string;
  ink: string;
  inkSoft: string;
  accent: string;
  footerText: string;
  // Brukes når mode=logo_only — logo størrelse
  logoScale: "small" | "medium" | "large";
}

export const DEFAULT_FOOTER_ACTIONS: FooterAction[] = [
  { code: "discount", label: "Rabatt", icon: "Percent" },
  { code: "label_print", label: "Merket lapp", icon: "Tag" },
  { code: "park_order", label: "Parker ordre", icon: "Pause" },
  { code: "clear_order", label: "Slett ordre", icon: "Trash2", variant: "danger" },
  { code: "receipt", label: "Kvittering", icon: "Receipt" },
];

export const DEFAULT_THEME: KioskTheme = {
  layoutKind: "tabs_top",
  bg: "#0F0E0E",
  surface: "rgba(255,255,255,0.04)",
  surfaceAlt: "rgba(255,255,255,0.08)",
  border: "rgba(255,255,255,0.08)",
  ink: "#F4ECDC",
  inkSoft: "rgba(244,236,220,0.65)",
  inkOnAccent: "#1B1410",
  accent: "#C9A84C",
  accentSoft: "rgba(201,168,76,0.18)",
  fontHeading: "Inter, system-ui, sans-serif",
  fontBody: "Inter, system-ui, sans-serif",
  radius: "12px",
  buttonRadius: "12px",
  headerBg: "#1B1410",
  headerInk: "#F4ECDC",
  cartBg: "rgba(255,255,255,0.02)",
  cartInk: "#F4ECDC",
  brandName: null,
  brandTagline: null,
  brandLogoUrl: null,
  brandMonogramUrl: null,
  headerStyle: "minimal",
  diningPlacement: "cart_chip",
  diningPillStyle: "soft",
  cartStyle: "compact",
  cartShowImages: false,
  cartShowStepper: false,
  footerStyle: "pill_grid",
  footerActions: DEFAULT_FOOTER_ACTIONS,
};

export const DEFAULT_CUSTOMER_SCREEN: CustomerScreenConfig = {
  mode: "logo_and_cart",
  bg: "#0F0E0E",
  ink: "#F4ECDC",
  inkSoft: "rgba(244,236,220,0.55)",
  accent: "#C9A84C",
  footerText: "Ønsker du kvittering? Spør betjeningen.",
  logoScale: "medium",
};

export function themeToVars(t: KioskTheme): CSSProperties {
  return {
    ["--kiosk-bg" as string]: t.bg,
    ["--kiosk-surface" as string]: t.surface,
    ["--kiosk-surface-alt" as string]: t.surfaceAlt,
    ["--kiosk-border" as string]: t.border,
    ["--kiosk-ink" as string]: t.ink,
    ["--kiosk-ink-soft" as string]: t.inkSoft,
    ["--kiosk-ink-on-accent" as string]: t.inkOnAccent,
    ["--kiosk-accent" as string]: t.accent,
    ["--kiosk-accent-soft" as string]: t.accentSoft,
    ["--kiosk-font-heading" as string]: t.fontHeading,
    ["--kiosk-font-body" as string]: t.fontBody,
    ["--kiosk-radius" as string]: t.radius,
    ["--kiosk-button-radius" as string]: t.buttonRadius,
    ["--kiosk-header-bg" as string]: t.headerBg,
    ["--kiosk-header-ink" as string]: t.headerInk,
    ["--kiosk-cart-bg" as string]: t.cartBg,
    ["--kiosk-cart-ink" as string]: t.cartInk,
  };
}

export function customerScreenToVars(c: CustomerScreenConfig): CSSProperties {
  return {
    ["--kiosk-cs-bg" as string]: c.bg,
    ["--kiosk-cs-ink" as string]: c.ink,
    ["--kiosk-cs-ink-soft" as string]: c.inkSoft,
    ["--kiosk-cs-accent" as string]: c.accent,
  };
}

// Parser fra jsonb. Mangler felt → fyll fra defaults. Validerer arrays.
export function parseTheme(value: unknown): KioskTheme {
  if (!value || typeof value !== "object") return DEFAULT_THEME;
  const v = value as Partial<KioskTheme>;
  const merged: KioskTheme = { ...DEFAULT_THEME, ...v };
  // Normaliser footerActions: må være array, hver post må ha code/label/icon
  if (!Array.isArray(merged.footerActions) || merged.footerActions.length === 0) {
    merged.footerActions = DEFAULT_FOOTER_ACTIONS;
  } else {
    merged.footerActions = merged.footerActions
      .filter((a): a is FooterAction =>
        !!a && typeof a === "object" &&
        typeof (a as FooterAction).code === "string" &&
        typeof (a as FooterAction).label === "string" &&
        typeof (a as FooterAction).icon === "string",
      );
    if (merged.footerActions.length === 0) merged.footerActions = DEFAULT_FOOTER_ACTIONS;
  }
  return merged;
}

export function parseCustomerScreen(value: unknown): CustomerScreenConfig {
  if (!value || typeof value !== "object") return DEFAULT_CUSTOMER_SCREEN;
  return { ...DEFAULT_CUSTOMER_SCREEN, ...(value as Partial<CustomerScreenConfig>) };
}
