// Maler for hele kassen — definerer theme + customer_screen + sider (m/ ikoner)
// + eksempel-knapper. "Bruk mal" skriver alt dette; "Bruk tema" rører kun theme.

import type { KioskTheme, CustomerScreenConfig } from "@/kiosk/render/kioskTheme";

export type TemplateKey = "notteroy" | "hvasser" | "halvorsen";

export interface TemplateButton {
  button_type: "category" | "function";
  display_label: string;
  function_code?: string;
  background_color?: string | null;
  text_color?: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
}

export interface TemplatePage {
  page_name: string;
  icon: string; // lucide-react ikon-navn
  background_color: string | null;
  buttons: TemplateButton[];
}

export interface KeypadTemplate {
  key: TemplateKey;
  name: string;
  tagline: string;
  description: string;
  gridCols: number;
  gridRows: number;
  theme: KioskTheme;
  customerScreen: CustomerScreenConfig;
  pages: TemplatePage[];
}

// ── Nøtterø Klassisk ─────────────────────────────────────────────────────────
// Tabs på toppen, 5 br × 4 r, brand-navy shell, cream canvas, bronze aksent.
const notteroy: KeypadTemplate = {
  key: "notteroy",
  name: "Nøtterø Klassisk",
  tagline: "Tabs på toppen · 5 × 4 · navy / cream / bronze",
  description:
    "Brand-stilen til Nøtterø Bakeri. Horisontal navigasjon, navy header, papir-cream kasse-canvas, bronze aksenter.",
  gridCols: 5,
  gridRows: 4,
  theme: {
    layoutKind: "tabs_top",
    bg: "#F4EEDF",
    surface: "#FBF6EA",
    surfaceAlt: "#ECE3CE",
    border: "#D9CDB4",
    ink: "#1F1A13",
    inkSoft: "#5C4F3F",
    inkOnAccent: "#F4ECDC",
    accent: "#A6712E",
    accentSoft: "rgba(166,113,46,0.14)",
    fontHeading: "Fraunces, Georgia, serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "12px",
    buttonRadius: "14px",
    headerBg: "#16243A",
    headerInk: "#F4ECDC",
    cartBg: "#FBF6EA",
    cartInk: "#1F1A13",
  },
  customerScreen: {
    mode: "logo_and_cart",
    bg: "#16243A",
    ink: "#F4ECDC",
    inkSoft: "rgba(244,236,220,0.65)",
    accent: "#D4A04A",
    footerText: "Velkommen til Nøtterø Bakeri",
    logoScale: "medium",
  },
  pages: [
    {
      page_name: "Brød",
      icon: "Wheat",
      background_color: null,
      buttons: [
        { button_type: "category", display_label: "Grovbrød", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Loff", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Surdeig", grid_x: 2, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Knekkebrød", grid_x: 3, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "function", display_label: "Rabatt", function_code: "discount", grid_x: 4, grid_y: 3, grid_width: 1, grid_height: 1, background_color: "#A6712E", text_color: "#F4ECDC" },
      ],
    },
    { page_name: "Rundstykker", icon: "Cookie", background_color: null, buttons: [] },
    { page_name: "Kaker", icon: "Cake", background_color: null, buttons: [] },
    { page_name: "Drikke", icon: "Coffee", background_color: null, buttons: [] },
    { page_name: "Annet", icon: "Package", background_color: null, buttons: [] },
  ],
};

// ── Hvasser Kyst ─────────────────────────────────────────────────────────────
// Sidebar venstre, 5 br × 4 r, lys sand + sage/olive aksent. Lett, kystnær.
const hvasser: KeypadTemplate = {
  key: "hvasser",
  name: "Hvasser Kyst",
  tagline: "Sidebar venstre · 5 × 4 · sand / sage",
  description:
    "Lys og luftig kasse-design med vertikal sidebar. Sandig canvas, sage/olive aksent, runde knapper.",
  gridCols: 5,
  gridRows: 4,
  theme: {
    layoutKind: "sidebar_left",
    bg: "#F2EDE2",
    surface: "#FFFFFF",
    surfaceAlt: "#E8E2D2",
    border: "#D6CFBE",
    ink: "#27241D",
    inkSoft: "#6B6557",
    inkOnAccent: "#FFFFFF",
    accent: "#5F7A4F",
    accentSoft: "rgba(95,122,79,0.14)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "16px",
    buttonRadius: "18px",
    headerBg: "#2F3A2A",
    headerInk: "#F2EDE2",
    cartBg: "#FFFFFF",
    cartInk: "#27241D",
  },
  customerScreen: {
    mode: "logo_only",
    bg: "#F2EDE2",
    ink: "#2F3A2A",
    inkSoft: "rgba(47,58,42,0.65)",
    accent: "#5F7A4F",
    footerText: "Hvasser Bakeri",
    logoScale: "large",
  },
  pages: [
    {
      page_name: "Brød",
      icon: "Wheat",
      background_color: null,
      buttons: [
        { button_type: "category", display_label: "Grovbrød", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Loff", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Speltbrød", grid_x: 2, grid_y: 0, grid_width: 1, grid_height: 1 },
      ],
    },
    { page_name: "Konditori", icon: "Cake", background_color: null, buttons: [] },
    { page_name: "Lunsj", icon: "Sandwich", background_color: null, buttons: [] },
    { page_name: "Drikke", icon: "Coffee", background_color: null, buttons: [] },
  ],
};

// ── Halvorsen Minimal ────────────────────────────────────────────────────────
// Sidebar venstre, 4 br × 5 r, hvit canvas, sort aksent, stor typografi.
const halvorsen: KeypadTemplate = {
  key: "halvorsen",
  name: "Halvorsen Minimal",
  tagline: "Sidebar venstre · 4 × 5 · sort / hvit",
  description:
    "Minimalistisk høy-kontrast design. Hvit canvas, sorte knapper, store fonter. Tett editorial look.",
  gridCols: 4,
  gridRows: 5,
  theme: {
    layoutKind: "sidebar_left",
    bg: "#FFFFFF",
    surface: "#F5F5F5",
    surfaceAlt: "#EAEAEA",
    border: "#D8D8D8",
    ink: "#0A0A0A",
    inkSoft: "#666666",
    inkOnAccent: "#FFFFFF",
    accent: "#0A0A0A",
    accentSoft: "rgba(10,10,10,0.08)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "4px",
    buttonRadius: "6px",
    headerBg: "#0A0A0A",
    headerInk: "#FFFFFF",
    cartBg: "#FFFFFF",
    cartInk: "#0A0A0A",
  },
  customerScreen: {
    mode: "logo_only",
    bg: "#0A0A0A",
    ink: "#FFFFFF",
    inkSoft: "rgba(255,255,255,0.6)",
    accent: "#FFFFFF",
    footerText: "Halvorsen",
    logoScale: "large",
  },
  pages: [
    {
      page_name: "Brød",
      icon: "Wheat",
      background_color: null,
      buttons: [
        { button_type: "category", display_label: "GROVT", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1, background_color: "#0A0A0A", text_color: "#FFFFFF" },
        { button_type: "category", display_label: "LYST", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1, background_color: "#0A0A0A", text_color: "#FFFFFF" },
      ],
    },
    { page_name: "Bakst", icon: "Cookie", background_color: null, buttons: [] },
    { page_name: "Kaffe", icon: "Coffee", background_color: null, buttons: [] },
    { page_name: "Annet", icon: "Package", background_color: null, buttons: [] },
  ],
};

export const TEMPLATES: KeypadTemplate[] = [notteroy, hvasser, halvorsen];

export function getTemplate(key: TemplateKey): KeypadTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
