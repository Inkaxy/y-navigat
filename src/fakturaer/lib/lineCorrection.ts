import type { Json } from "@/integrations/supabase/types";
import type { ReadIssue } from "@/fakturaer/lib/invoiceReadCheck";
import { parseNorwegianNumber } from "@/fakturaer/lib/invoiceReadCheck";

/** Feltene «Rett fakturalinje» kan endre — samme liste som rm_correct_invoice_line. */
export const CORRECTION_FIELDS = [
  "supplier_sku", "description", "quantity", "unit", "package_size", "package_unit", "count_per_package", "unit_price", "total_amount", "line_kind",
] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export const NUMERIC_FIELDS: readonly CorrectionField[] = ["quantity", "package_size", "count_per_package", "unit_price", "total_amount"];

export const CORRECTION_FIELD_LABEL: Record<CorrectionField, string> = {
  supplier_sku: "Varenr.",
  description: "Beskrivelse",
  quantity: "Mengde",
  unit: "Enhet",
  package_size: "Pakningsstørrelse",
  package_unit: "Pakningsenhet",
  count_per_package: "Antall per pakning",
  unit_price: "Enhetspris eks. mva",
  total_amount: "Linjesum eks. mva",
  line_kind: "Linjetype",
};

export const LINE_KIND_OPTIONS: readonly { value: string; label: string; hint: string }[] = [
  { value: "vare", label: "Vare", hint: "Råvare eller emballasje som skal kobles og prissjekkes." },
  { value: "pant", label: "Pant", hint: "Pant på emballasje. Ikke en vare." },
  { value: "frakt", label: "Frakt", hint: "Frakt eller levering. Ikke en vare." },
  { value: "gebyr", label: "Gebyr", hint: "Faktura- eller miljøgebyr. Ikke en vare." },
  { value: "rabatt", label: "Rabatt", hint: "Egen rabattlinje (ofte negativ)." },
  { value: "avrunding", label: "Avrunding", hint: "Øreavrunding." },
  { value: "mva", label: "Mva", hint: "Mva-linje som feilaktig er lest som en vare." },
  { value: "annet", label: "Annet", hint: "Noe annet som ikke er en vare." },
];

export type CorrectionValues = Record<CorrectionField, string | number | null>;
export type CorrectionDraft = Record<CorrectionField, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Lesevarsler fra databasen (jsonb) som typet liste. */
export function parseReadIssues(v: Json | unknown): ReadIssue[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (isRecord(x) && typeof x.code === "string" ? [{ code: x.code, message: typeof x.message === "string" ? x.message : "" }] : []));
}

export function draftFrom(values: CorrectionValues): CorrectionDraft {
  const out = {} as CorrectionDraft;
  for (const f of CORRECTION_FIELDS) {
    const v = values[f];
    out[f] = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
  }
  return out;
}

export type ChangesResult = { changes: Partial<Record<CorrectionField, string | number | null>>; errors: Partial<Record<CorrectionField, string>> };

/** Bare felt som faktisk er endret, med norske tall tolket. Ugyldige tall gir feil per felt. */
export function buildChanges(original: CorrectionValues, draft: CorrectionDraft): ChangesResult {
  const changes: ChangesResult["changes"] = {};
  const errors: ChangesResult["errors"] = {};
  for (const f of CORRECTION_FIELDS) {
    const raw = draft[f].trim();
    let next: string | number | null;
    if (NUMERIC_FIELDS.includes(f)) {
      if (raw === "") next = null;
      else {
        const n = parseNorwegianNumber(raw);
        if (n == null) { errors[f] = "Ikke et gyldig tall"; continue; }
        if ((f === "package_size" || f === "count_per_package") && n <= 0) { errors[f] = "Må være større enn 0"; continue; }
        next = n;
      }
    } else next = raw === "" ? null : raw;
    const before = original[f] == null ? null : NUMERIC_FIELDS.includes(f) ? Number(original[f]) : String(original[f]);
    if (before !== next) changes[f] = next;
  }
  return { changes, errors };
}

const ERRORS: readonly [RegExp, string][] = [
  [/versjon_endret/, "Linjen er endret siden du åpnet den. Last inn på nytt og prøv igjen."],
  [/faktura_godkjent/, "Fakturaen er internt godkjent. Trekk tilbake godkjenningen før du retter linjer."],
  [/faktura_last/, "Fakturaen er avstemt, flagget eller lukket. Linjene kan ikke rettes."],
  [/kostpris_fort/, "Kostpris er ført for linjen. Den kan ikke rettes."],
  [/forbidden|42501/, "Du mangler skrivetilgang til fakturaer."],
  [/begrunnelse/, "Skriv en begrunnelse for rettelsen."],
  [/ingen_endring/, "Ingen felt er endret."],
  [/ugyldig_tall/, "Et tall er ugyldig."],
  [/ugyldig_linjetype/, "Ugyldig linjetype."],
];

export function correctionErrorMessage(message: string | null | undefined): string {
  const m = message ?? "";
  return ERRORS.find(([re]) => re.test(m))?.[1] ?? "Rettelsen ble ikke lagret. Prøv igjen.";
}

export type CorrectionResult = { ok: boolean; changed: string[]; remainingIssues: ReadIssue[]; exampleId: string | null; linesSumStatus: string | null };

export function parseCorrectionResult(v: Json | null): CorrectionResult {
  const o = isRecord(v) ? v : {};
  return {
    ok: o.ok === true,
    changed: Array.isArray(o.changed) ? o.changed.filter((x): x is string => typeof x === "string") : [],
    remainingIssues: parseReadIssues(o.remaining_issues),
    exampleId: typeof o.example_id === "string" ? o.example_id : null,
    linesSumStatus: typeof o.lines_sum_status === "string" ? o.lines_sum_status : null,
  };
}

/** Hvorfor linjen ikke kan rettes i UI (serveren avgjør alltid). */
export function correctionLockReason(i: { status: string | null; approved: boolean; costPosted: boolean }): string | null {
  if (i.costPosted) return "Kostpris er ført for linjen. Den kan ikke rettes.";
  if (i.approved) return "Fakturaen er internt godkjent. Trekk tilbake godkjenningen før du retter linjer.";
  if (!["imported", "needs_review", "ready"].includes(i.status ?? "")) return "Fakturaen er avstemt, flagget eller lukket. Linjene kan ikke rettes.";
  return null;
}
