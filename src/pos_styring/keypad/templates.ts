// Maler for hele kassen — definerer theme + customer_screen + sider (m/ ikoner)
// + eksempel-knapper. "Bruk mal" skriver alt dette; "Bruk tema" rører kun theme.
// Fargene er lest direkte fra de tre vedlagte design-bildene.

import type { KioskTheme, CustomerScreenConfig } from "@/kiosk/render/kioskTheme";

export type TemplateKey =
  | "notteroy"
  | "hvasser"
  | "halvorsen"
  | "bakeri_standard"
  | "kafe"
  | "sesong_jul";

export interface TemplateButton {
  button_type: "category" | "function";
  display_label: string;
  function_code?: string;
  /** For category-knapper: matcher TemplatePage.page_name som blir slått opp til target_page_id ved insert. */
  targetPageKey?: string;
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
  /** Hint til «Fyll fra varegruppe»-dialogen for dynamiske maler. */
  sourceKindHint?: "main_category" | "sub_category" | "production_group";
  sourceNameHint?: string;
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
// Sidebar venstre, 4 br × 3 r. Navy header med brand-blokk + ur/operatør,
// hero-pills for dining, rich kurv m/ thumbnails+steppers, compact_row footer.
const notteroy: KeypadTemplate = {
  key: "notteroy",
  name: "Nøtterø Klassisk",
  tagline: "Branded header · hero dining · rich kurv · navy/cream/bronze",
  description:
    "Nøtterø Bakeri sin merkevare. Mørk navy topbar med logo+navn, venstre-sidebar, cream papir-canvas, bronze 'Betaling'-CTA. Rich kurv med produktbilder og +/- steppers.",
  gridCols: 4,
  gridRows: 3,
  theme: {
    layoutKind: "sidebar_left",
    bg: "#F4ECDC",
    surface: "#FFFFFF",
    surfaceAlt: "#EBE2CC",
    border: "#D9CDB4",
    ink: "#1B2A44",
    inkSoft: "#5C6A82",
    inkOnAccent: "#FFFFFF",
    accent: "#B27A3A",
    accentSoft: "rgba(178,122,58,0.14)",
    fontHeading: "Fraunces, Georgia, serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "10px",
    buttonRadius: "12px",
    headerBg: "#0F1B33",
    headerInk: "#F4ECDC",
    cartBg: "#FFFFFF",
    cartInk: "#1B2A44",
    brandName: "NØTTERØ BAKERI",
    brandTagline: "1898 · Vestfolds eldste",
    brandLogoUrl: null,
    brandMonogramUrl: null,
    headerStyle: "branded_left",
    diningPlacement: "top_hero",
    diningPillStyle: "soft",
    cartStyle: "rich",
    cartShowImages: true,
    cartShowStepper: true,
    footerStyle: "compact_row",
    footerActions: [
      { code: "customer", label: "Kunde", icon: "User" },
      { code: "discount", label: "Rabatt", icon: "Percent" },
      { code: "receipt", label: "Kvittering", icon: "Receipt" },
      { code: "park_order", label: "Parker", icon: "Pause" },
      { code: "clear_order", label: "Slett", icon: "Trash2", variant: "danger" },
    ],
  },
  customerScreen: {
    mode: "logo_and_cart",
    bg: "#0F1B33",
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
        { button_type: "category", display_label: "Landbrød", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Surdeigsbrød", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Kanelbolle", grid_x: 2, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Skolebolle", grid_x: 3, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Croissant", grid_x: 0, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Pain au chocolat", grid_x: 1, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Cappuccino", grid_x: 2, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Caffè latte", grid_x: 3, grid_y: 1, grid_width: 1, grid_height: 1 },
      ],
    },
    { page_name: "Boller", icon: "Cookie", background_color: null, buttons: [] },
    { page_name: "Kaker", icon: "Cake", background_color: null, buttons: [] },
    { page_name: "Påsmurt", icon: "Sandwich", background_color: null, buttons: [] },
    { page_name: "Kaffe", icon: "Coffee", background_color: null, buttons: [] },
    { page_name: "Drikke", icon: "CupSoda", background_color: null, buttons: [] },
    { page_name: "Frokost", icon: "Croissant", background_color: null, buttons: [] },
    { page_name: "Favoritter", icon: "Star", background_color: null, buttons: [] },
  ],
};

// ── Hvasser Isbar ────────────────────────────────────────────────────────────
// Sidebar venstre, 5 br × 2 r. Cream canvas, navy ink, pastell hero-pills,
// branded_centered header, icon_card footer.
const hvasser: KeypadTemplate = {
  key: "hvasser",
  name: "Hvasser Isbar",
  tagline: "Branded centered · hero pastell-pills · icon-card footer",
  description:
    "Lekent kystdesign for isbar. Cream canvas, navy tekst, store pastell dining-pills (blå/peach/sand), soft blå Betal-CTA, illustrasjons-stil.",
  gridCols: 5,
  gridRows: 2,
  theme: {
    layoutKind: "sidebar_left",
    bg: "#F5EFE0",
    surface: "#FBF6EA",
    surfaceAlt: "#E8E0CC",
    border: "#D9CFB6",
    ink: "#1B2A44",
    inkSoft: "#6A7587",
    inkOnAccent: "#FFFFFF",
    accent: "#A9C2D9",
    accentSoft: "rgba(169,194,217,0.30)",
    fontHeading: "Fraunces, Georgia, serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "16px",
    buttonRadius: "18px",
    headerBg: "#F5EFE0",
    headerInk: "#1B2A44",
    cartBg: "#FBF6EA",
    cartInk: "#1B2A44",
    brandName: "HVASSER ISBAR",
    brandTagline: "Sandefjord 1951",
    brandLogoUrl: null,
    brandMonogramUrl: null,
    headerStyle: "branded_centered",
    diningPlacement: "top_hero",
    diningPillStyle: "soft",
    cartStyle: "compact",
    cartShowImages: false,
    cartShowStepper: false,
    footerStyle: "pill_grid",
    footerActions: [
      { code: "discount", label: "Rabatt", icon: "Percent" },
      { code: "label_print", label: "Merket lapp", icon: "Tag" },
      { code: "park_order", label: "Parker ordre", icon: "Pause" },
      { code: "clear_order", label: "Slett ordre", icon: "Trash2", variant: "danger" },
    ],
  },
  customerScreen: {
    mode: "logo_and_cart",
    bg: "#F5EFE0",
    ink: "#1B2A44",
    inkSoft: "rgba(27,42,68,0.60)",
    accent: "#A9C2D9",
    footerText: "Hvasser Isbar · Sandefjord 1951",
    logoScale: "large",
  },
  pages: [
    {
      page_name: "Iskrem",
      icon: "IceCream",
      background_color: null,
      buttons: [
        { button_type: "category", display_label: "Sjokolade", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Jordbær", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Vanilje", grid_x: 2, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Pistasj", grid_x: 3, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Mango sorbet", grid_x: 4, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Cookies & cream", grid_x: 0, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Salt karamell", grid_x: 1, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Bringebær sorbet", grid_x: 2, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Kokos", grid_x: 3, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Kule iskrem", grid_x: 4, grid_y: 1, grid_width: 1, grid_height: 1 },
      ],
    },
    { page_name: "Softis", icon: "IceCreamCone", background_color: null, buttons: [] },
    { page_name: "Milkshake", icon: "CupSoda", background_color: null, buttons: [] },
    { page_name: "Sundae", icon: "IceCreamBowl", background_color: null, buttons: [] },
    { page_name: "Iskaffe", icon: "Coffee", background_color: null, buttons: [] },
    { page_name: "Bakst", icon: "Cookie", background_color: null, buttons: [] },
    { page_name: "Drikke", icon: "GlassWater", background_color: null, buttons: [] },
    { page_name: "Annet", icon: "MoreHorizontal", background_color: null, buttons: [] },
  ],
};

// ── Baker Halvorsen ──────────────────────────────────────────────────────────
// Sidebar venstre, 4 br × 3 r. Cream canvas, sort serif tittel, kobber-brun
// aksent, branded_centered header, top_hero pills, icon_card footer.
const halvorsen: KeypadTemplate = {
  key: "halvorsen",
  name: "Baker Halvorsen",
  tagline: "Editorial · branded centered · icon-card footer",
  description:
    "Klassisk konditori-design. Cream canvas, sort serif logo, kobber-brun aksent og Betal-CTA, ikon-stil 1-px linje.",
  gridCols: 4,
  gridRows: 3,
  theme: {
    layoutKind: "sidebar_left",
    bg: "#F4ECDC",
    surface: "#FFFFFF",
    surfaceAlt: "#EADFC6",
    border: "#D8CBAF",
    ink: "#1A1612",
    inkSoft: "#5A4F3F",
    inkOnAccent: "#FFFFFF",
    accent: "#8C5A2B",
    accentSoft: "rgba(140,90,43,0.14)",
    fontHeading: "Cormorant Garamond, Georgia, serif",
    fontBody: "Inter, system-ui, sans-serif",
    radius: "10px",
    buttonRadius: "12px",
    headerBg: "#F4ECDC",
    headerInk: "#1A1612",
    cartBg: "#FFFFFF",
    cartInk: "#1A1612",
    brandName: "BAKER HALVORSEN",
    brandTagline: "ETAB. 1879",
    brandLogoUrl: null,
    brandMonogramUrl: null,
    headerStyle: "branded_centered",
    diningPlacement: "top_hero",
    diningPillStyle: "outlined",
    cartStyle: "compact",
    cartShowImages: false,
    cartShowStepper: false,
    footerStyle: "icon_card",
    footerActions: [
      { code: "discount", label: "Rabatt", icon: "Percent" },
      { code: "label_print", label: "Merket lapp", icon: "Tag" },
      { code: "park_order", label: "Parker ordre", icon: "Pause" },
      { code: "clear_order", label: "Slett ordre", icon: "Trash2", variant: "danger" },
      { code: "receipt", label: "Kvittering", icon: "Receipt" },
    ],
  },
  customerScreen: {
    mode: "logo_only",
    bg: "#F4ECDC",
    ink: "#1A1612",
    inkSoft: "rgba(26,22,18,0.60)",
    accent: "#8C5A2B",
    footerText: "Baker Halvorsen · Etab. 1879",
    logoScale: "large",
  },
  pages: [
    {
      page_name: "Brød",
      icon: "Wheat",
      background_color: null,
      buttons: [
        { button_type: "category", display_label: "Halvorsenbrød", grid_x: 0, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Grovt surdeigsbrød", grid_x: 1, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Speltbrød", grid_x: 2, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Frokostbrød", grid_x: 3, grid_y: 0, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Rundstykke", grid_x: 0, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Kanelbolle", grid_x: 1, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Wienerbrød", grid_x: 2, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Skolebolle", grid_x: 3, grid_y: 1, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Croissant", grid_x: 0, grid_y: 2, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Knas", grid_x: 1, grid_y: 2, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Baguette", grid_x: 2, grid_y: 2, grid_width: 1, grid_height: 1 },
        { button_type: "category", display_label: "Pågenlimpa", grid_x: 3, grid_y: 2, grid_width: 1, grid_height: 1 },
      ],
    },
    { page_name: "Bakst", icon: "Cookie", background_color: null, buttons: [] },
    { page_name: "Kaker", icon: "Cake", background_color: null, buttons: [] },
    { page_name: "Sandwich", icon: "Sandwich", background_color: null, buttons: [] },
    { page_name: "Salater", icon: "Salad", background_color: null, buttons: [] },
    { page_name: "Kaffe & drikke", icon: "Coffee", background_color: null, buttons: [] },
    { page_name: "Annet", icon: "MoreHorizontal", background_color: null, buttons: [] },
  ],
};

export const TEMPLATES: KeypadTemplate[] = [notteroy, hvasser, halvorsen];

export function getTemplate(key: TemplateKey): KeypadTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
