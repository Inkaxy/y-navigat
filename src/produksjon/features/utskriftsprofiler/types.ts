export const FIELD_TYPES = [
  "logo",
  "hentested",
  "kundenavn",
  "bestilt_av",
  "distribusjon",
  "varenr",
  "varenavn",
  "antall",
  "kjorerute",
  "pakkseddelnr",
  "melding_pakkseddel",
  "fyll",
  "leveringsadresse",
  "etikett_nr",
  "strekkode",
  "tekst",
  "pynt",
  "kommentar",
  "sist_endret",
  "firmanavn",
  "firmamerknad",
  "sukkerbilde",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_LABELS: Record<FieldType, string> = {
  logo: "Logo",
  hentested: "Hentested",
  kundenavn: "Kundenavn",
  bestilt_av: "Bestilt av",
  distribusjon: "Distribusjon",
  varenr: "Varenr",
  varenavn: "Varenavn",
  antall: "Antall",
  kjorerute: "Kjørerute",
  pakkseddelnr: "Pakkseddelnr",
  melding_pakkseddel: "Melding på pakkseddel",
  fyll: "Fyll",
  leveringsadresse: "Leveringsadresse",
  strekkode: "Strekkode",
  tekst: "Tekst",
  pynt: "Pynt",
  kommentar: "Kommentar",
  sist_endret: "Sist endret",
  firmanavn: "Firmanavn",
  firmamerknad: "Firmamerknad",
  sukkerbilde: "Sukkerbilde",
  etikett_nr: "Etikett-nr",
};

export type FieldGroup = "bestilling" | "vare" | "pakkseddel" | "firma" | "system";

export const FIELD_GROUPS: Record<FieldType, FieldGroup> = {
  kundenavn: "bestilling",
  bestilt_av: "bestilling",
  leveringsadresse: "bestilling",
  distribusjon: "bestilling",
  kjorerute: "bestilling",
  varenavn: "vare",
  varenr: "vare",
  antall: "vare",
  fyll: "vare",
  pynt: "vare",
  tekst: "vare",
  sukkerbilde: "vare",
  pakkseddelnr: "pakkseddel",
  melding_pakkseddel: "pakkseddel",
  kommentar: "pakkseddel",
  hentested: "pakkseddel",
  logo: "firma",
  firmanavn: "firma",
  firmamerknad: "firma",
  strekkode: "system",
  sist_endret: "system",
  etikett_nr: "system",
};

export const GROUP_LABELS: Record<FieldGroup, string> = {
  bestilling: "Bestilling",
  vare: "Vare",
  pakkseddel: "Pakkseddel",
  firma: "Firma",
  system: "System",
};

export const WIDTH_FRACTIONS = ["1", "3/4", "2/3", "1/2", "1/3", "1/4"] as const;
export type WidthFraction = (typeof WIDTH_FRACTIONS)[number];

export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export interface ProfileField {
  field_type: FieldType;
  include: boolean;
  /** @deprecated Use y_mm/x_mm canvas coordinates */
  row_number: number;
  font_size: number;
  bold: boolean;
  /** @deprecated Use y_mm */
  margin_top_mm: number | null;
  /** @deprecated Use x_mm */
  margin_left_mm: number | null;
  /** @deprecated Use width_mm */
  width_fraction: WidthFraction;
  /** @deprecated Use height_mm */
  row_count: number | null;
  alignment: Alignment;
  show_line: boolean;
  show_border: boolean;
  /** @deprecated Use y_mm */
  print_at_bottom: boolean;
  // New canvas-coordinate model (in mm, relative to label margin box)
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  z_index: number;
}

export interface CommentIncludes {
  fritekst1: boolean;
  fritekst2: boolean;
  fritekst3: boolean;
}

export interface LabelPrintProfile {
  id: string;
  legal_entity_id: string;
  name: string;
  paper_width_mm: number;
  paper_height_mm: number;
  margin_top_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  orientation: "landscape" | "portrait";
  company_name: string;
  company_note: string | null;
  logo_url: string | null;
  logo_height_mm: number | null;
  fields: ProfileField[];
  comment_includes: CommentIncludes;
  include_field_labels: boolean;
  field_labels_bold: boolean;
  skip_leveres_hentes_if_empty: boolean;
  include_route_name: boolean;
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface LabelPrintProfileInput {
  legal_entity_id: string;
  name: string;
  paper_width_mm: number;
  paper_height_mm: number;
  margin_top_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  orientation: "landscape" | "portrait";
  company_name: string;
  company_note: string | null;
  logo_url: string | null;
  logo_height_mm: number | null;
  fields: ProfileField[];
  comment_includes: CommentIncludes;
  include_field_labels: boolean;
  field_labels_bold: boolean;
  skip_leveres_hentes_if_empty: boolean;
  include_route_name: boolean;
  notes: string | null;
}

export interface LabelPrintProfileUpdate
  extends Omit<LabelPrintProfileInput, "legal_entity_id"> {
  id: string;
}

/** Standard-størrelser per felt-type i mm. */
const DEFAULT_SIZES: Record<FieldType, { w: number; h: number }> = {
  logo: { w: 30, h: 15 },
  firmanavn: { w: 60, h: 6 },
  firmamerknad: { w: 60, h: 5 },
  kundenavn: { w: 60, h: 6 },
  bestilt_av: { w: 60, h: 5 },
  leveringsadresse: { w: 60, h: 12 },
  distribusjon: { w: 40, h: 5 },
  kjorerute: { w: 40, h: 5 },
  hentested: { w: 40, h: 5 },
  varenavn: { w: 60, h: 6 },
  varenr: { w: 30, h: 5 },
  antall: { w: 20, h: 5 },
  fyll: { w: 40, h: 5 },
  pynt: { w: 40, h: 5 },
  tekst: { w: 60, h: 8 },
  sukkerbilde: { w: 30, h: 15 },
  pakkseddelnr: { w: 30, h: 5 },
  melding_pakkseddel: { w: 60, h: 8 },
  kommentar: { w: 60, h: 8 },
  strekkode: { w: 50, h: 12 },
  sist_endret: { w: 40, h: 4 },
  etikett_nr: { w: 35, h: 8 },
};

export function defaultFieldSize(type: FieldType): { w: number; h: number } {
  return DEFAULT_SIZES[type];
}

/** Default-felt for ny profil — alle 21, alle off, sensible defaults. */
export function defaultFields(): ProfileField[] {
  return FIELD_TYPES.map((field_type, idx) => {
    const size = DEFAULT_SIZES[field_type];
    return {
      field_type,
      include: false,
      row_number: idx + 1,
      font_size: 10,
      bold: false,
      margin_top_mm: null,
      margin_left_mm: null,
      width_fraction: "1" as WidthFraction,
      row_count: null,
      alignment: "left" as Alignment,
      show_line: false,
      show_border: false,
      print_at_bottom: false,
      x_mm: 0,
      y_mm: 0,
      width_mm: size.w,
      height_mm: size.h,
      z_index: idx,
    };
  });
}
