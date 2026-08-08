/**
 * Registry over alle felter som kan overstyres på kundenivå (over profilens default).
 * Brukes av OverrideField, kundedetaljsiden og resolve-funksjonen.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "boolean"
  | "select";

export type SelectOption = { value: string; label: string };

/** Kilder for dynamisk-fetched dropdown-options (FK-felt). Resolves i UI-laget. */
export type DynamicSource = "pickup_locations";

export type ProfileFieldDef = {
  /** Navn på kolonnen i customer_profiles og nøkkel i profile_overrides */
  key: string;
  label: string;
  type: FieldType;
  /** Vis i "Vanlig"-modus, eller bak "Avansert"-toggle */
  advanced?: boolean;
  options?: SelectOption[];
  /** Hvis satt, fetches options dynamisk fra denne kilden i UI-komponenten. */
  dynamicSource?: DynamicSource;
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Felter som har sin egen seksjon (gruppe-header), brukes av UI for layout */
  group?: string;
};

const invoiceMethodOptions: SelectOption[] = [
  { value: "bankgiro", label: "0 — Bankgiro" },
  { value: "none", label: "1 — Sendes ikke" },
  { value: "chain_invoice", label: "5 — Kjedefaktura" },
  { value: "ehf", label: "6 — EHF" },
  { value: "ehf_bulk", label: "7 — EHF samle" },
  { value: "email_pdf", label: "8 — Epost-faktura" },
  { value: "e2b", label: "9 — e2b" },
];

const invoicingGroupOptions: SelectOption[] = [
  { value: "cash", label: "0 — Kontant" },
  { value: "weekly", label: "1 — Ukentlig" },
  { value: "biweekly", label: "2 — 14-daglig" },
  { value: "monthly", label: "3 — Månedlig" },
  { value: "internal_outlets", label: "4 — Egne utsalg" },
  { value: "test", label: "5 — Test" },
];

const combinePeriodOptions: SelectOption[] = [
  { value: "day", label: "Dag" },
  { value: "week", label: "Uke" },
  { value: "month", label: "Måned" },
  { value: "never", label: "Aldri" },
];

const invoiceAttachmentOptions: SelectOption[] = [
  { value: "specified_per_week", label: "1 — Spesifisert pr. uke" },
  { value: "packing_slip_number", label: "2 — Pakkseddelnummer" },
  { value: "specified_packing_slips", label: "3 — Spesifisert pakksedler" },
  { value: "invoice_line_list", label: "4 — List fakturalinjer" },
];

const mvaCodeOptions: SelectOption[] = [
  { value: "H", label: "H — Høy (25 %)" },
  { value: "F", label: "F — Mat (15 %)" },
  { value: "L", label: "L — Lav (12 %)" },
  { value: "N", label: "N — Null (0 %)" },
];

const orderConfirmationOptions: SelectOption[] = [
  { value: "none", label: "Ingen" },
  { value: "email", label: "E-post" },
  { value: "sms", label: "SMS" },
];

/** Faktura- og betalingsfelter (Tab: Faktura) */
export const INVOICE_FIELDS: ProfileFieldDef[] = [
  { key: "invoice_method", label: "Fakturametode", type: "select", options: invoiceMethodOptions },
  { key: "include_attachments_in_ehf", label: "Inkluder vedlegg i EHF", type: "boolean", advanced: true },
  { key: "invoicing_profile", label: "Regnskapsprofil", type: "text", advanced: true },
  { key: "invoicing_group", label: "Faktureringsgruppe", type: "select", options: invoicingGroupOptions },
  { key: "combine_orders_period", label: "Slå sammen ordrer", type: "select", options: combinePeriodOptions },
  { key: "payment_terms_days", label: "Betalingsfrist (dager)", type: "number", min: 0, max: 365 },
  { key: "invoice_attachment", label: "Fakturavedlegg", type: "select", options: invoiceAttachmentOptions, advanced: true },
  { key: "offer_delivery_report", label: "Tilby leveringsrapport", type: "boolean", advanced: true },
  { key: "one_order_per_invoice", label: "Én ordre per faktura", type: "boolean", advanced: true },
  { key: "include_empty_lines", label: "Ta med tomme linjer", type: "boolean", advanced: true },
  { key: "skip_delivery_name_in_accounting_cost", label: "Ikke ta med leveringsnavn i kostnadssted", type: "boolean", advanced: true },
  { key: "include_store_number_in_contact_id", label: "Ta med butikknr i kontakt-ID", type: "boolean", advanced: true },
  { key: "copy_invoice_to_email", label: "Kopi av faktura til e-post", type: "email" },
  { key: "default_department_project", label: "Standard avdeling/prosjekt", type: "text", advanced: true },
  { key: "default_order_reference", label: "Standard ordrereferanse", type: "text", advanced: true },
];

/** Prising (Tab: Pris) */
export const PRICING_FIELDS: ProfileFieldDef[] = [
  { key: "mva_code", label: "MVA-kode", type: "select", options: mvaCodeOptions },
  { key: "use_retail_price", label: "Bruk utsalgspris", type: "boolean" },
  { key: "fixed_discount_percent", label: "Fast rabatt (%)", type: "number", min: 0, max: 100, step: 0.01 },
  { key: "show_price_list_to_customer", label: "Vis prisliste til kunde", type: "boolean", advanced: true },
  { key: "return_price_reduction_percent", label: "Reduksjon ved retur (%)", type: "number", min: 0, max: 100, step: 0.01, advanced: true },
  { key: "only_products_with_price_in_offer_group", label: "Kun varer med pris i tilbudsgruppe", type: "boolean", advanced: true },
];

/** Utkjøring og utskrifter (Tab: Utkjøring) */
export const DELIVERY_FIELDS: ProfileFieldDef[] = [
  { key: "order_confirmation_mode", label: "Ordrebekreftelse", type: "select", options: orderConfirmationOptions },
  { key: "order_confirmation_emails", label: "E-post for ordrebekreftelse", type: "text", placeholder: "komma-separert" },
  {
    key: "packing_slip_delivery_mode",
    label: "Sending av følgeseddel/utskrifter",
    type: "select",
    options: [
      { value: "none", label: "Ingen — kun manuell utskrift" },
      { value: "per_customer", label: "Per kunde — bruk innstillinger fra kundekortet" },
      { value: "email", label: "E-post (PDF) — felles for alle" },
      { value: "print", label: "Utskrift" },
      { value: "both", label: "Både e-post og utskrift" },
    ],
  },
  {
    key: "packing_slip_emails",
    label: "E-poster for følgeseddel",
    type: "text",
    placeholder: "komma-separert",
  },
  {
    key: "print_declaration_labels",
    label: "Skriv ut varedeklarasjons-etiketter",
    type: "boolean",
    description: "En etikett per vare med allergener og ingredienser",
  },
  {
    key: "price_on_packing_slip",
    label: "Vis pris på pakkseddel",
    type: "boolean",
    description: "Stykkpris per linje",
  },
  {
    key: "sum_on_packing_slip",
    label: "Vis sum på pakkseddel",
    type: "boolean",
    description: "Totalsum nederst",
  },
  {
    key: "retail_price_on_packing_slip",
    label: "Vis utsalgspris på pakkseddel",
    type: "boolean",
    description: "Pris kunden selger varen for (butikker/kafeer)",
  },
  {
    key: "next_order_same_route_on_packing_slip",
    label: "Vis neste ordre samme rute",
    type: "boolean",
    advanced: true,
    description: "Vis også kommende bestilling på pakkseddelen",
  },
  {
    key: "include_change_log_on_packing_slip",
    label: "Vis endringshistorikk på pakkseddel",
    type: "boolean",
    advanced: true,
    description: "Liste endringer siden opprettet",
  },
];

/** Integrasjoner (Tab: Utkjøring) */
export const INTEGRATION_FIELDS: ProfileFieldDef[] = [
  {
    key: "send_to_pos_system",
    label: "Send ordre til kasse",
    type: "boolean",
    description: "Ordrer sendes automatisk til POS ved levering",
  },
];

/** Forventet ordre (ukedager) — alltid synlig på utkjøring-tab */
export const EXPECTED_ORDER_DAYS: ProfileFieldDef[] = [
  { key: "expects_order_monday", label: "Mandag", type: "boolean" },
  { key: "expects_order_tuesday", label: "Tirsdag", type: "boolean" },
  { key: "expects_order_wednesday", label: "Onsdag", type: "boolean" },
  { key: "expects_order_thursday", label: "Torsdag", type: "boolean" },
  { key: "expects_order_friday", label: "Fredag", type: "boolean" },
  { key: "expects_order_saturday", label: "Lørdag", type: "boolean" },
  { key: "expects_order_sunday", label: "Søndag", type: "boolean" },
];

export const ALL_OVERRIDABLE_FIELDS: ProfileFieldDef[] = [
  ...INVOICE_FIELDS,
  ...PRICING_FIELDS,
  ...DELIVERY_FIELDS,
  ...EXPECTED_ORDER_DAYS,
  ...INTEGRATION_FIELDS,
];

/** Sluttbruker-vennlig formatering av en verdi for visning som "arvet verdi".
 *  `dynamicOptions` brukes for FK-felter (f.eks. pickup_location_id) der options
 *  kommer fra en runtime-kilde i stedet for registry-en. */
export function formatInheritedValue(
  field: ProfileFieldDef,
  value: unknown,
  dynamicOptions?: SelectOption[],
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value ? "Ja" : "Nei";
  if (field.type === "select") {
    const opts = dynamicOptions ?? field.options;
    if (opts) return opts.find((o) => o.value === value)?.label ?? String(value);
  }
  if (field.type === "number") {
    return String(value);
  }
  return String(value);
}
