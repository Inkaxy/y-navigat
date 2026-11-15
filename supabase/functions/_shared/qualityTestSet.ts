// Fast testsett for kvalitetstesten av fakturalesing (før gjenlesing). Ren data uten import:
// brukes av invoice-model-eval (serveren avgjør rollen, aldri klienten) og av siden under AI-tjenester.
//
// Utvalget ble hentet med lesespørringer 15.11.2026:
//  - fasit: status avstemt, lines_sum_status = ok, alle varelinjer koblet, original-PDF finnes. Lagrede,
//    godkjente linjer er fasit. Drammen Papir, Flemming Egg og Stangeland Mølle har ingen faktura som
//    oppfyller dette; de er dekket av de vanskelige og av «uten linjer».
//  - vanskelig: navngitt av Henrik. Lagrede linjer er IKKE fasit (sumavvik), unntatt PALS 526301 som
//    har dokumentkontrollert fasit i evalFasit.ts.
//  - uten_linjer: 3 av de 45 som ble lagret uten linjer etter 19.10.2026, fra tre leverandører.

export type QualityRole = "fasit" | "vanskelig" | "uten_linjer";

export interface QualityTestInvoice {
  invoice_id: string;
  invoice_number: string;
  supplier: string;
  role: QualityRole;
  /** Hva fakturaen skal vise i testen. */
  note: string;
}

export const QUALITY_TEST_VERSION = "kvalitetstest-v1-2026-11-15";

export const QUALITY_TEST_SET: readonly QualityTestInvoice[] = [
  { invoice_id: "19a93c58-87b1-4472-adc6-fa9a2f46771b", invoice_number: "264665302", supplier: "TINE", role: "fasit", note: "5 linjer" },
  { invoice_id: "e9ff236d-d1d4-4989-85b9-7bf6d4f72244", invoice_number: "264713594", supplier: "TINE", role: "fasit", note: "4 linjer" },
  { invoice_id: "65ac59ad-896d-4ad0-ae56-e7abcf0e8de4", invoice_number: "667377", supplier: "PALS", role: "fasit", note: "6 linjer, uten lagret varenummer" },
  { invoice_id: "e15defa7-a3f7-43a6-a1e1-0ff121f83ac7", invoice_number: "002615718", supplier: "Norgesmøllene", role: "fasit", note: "3 linjer" },
  { invoice_id: "d8e42963-8190-475a-b505-91d40e77eae5", invoice_number: "136008184", supplier: "Lantmännen Cerealia", role: "fasit", note: "2 linjer, mva kjent" },
  { invoice_id: "6ea4c5a4-3e88-490a-aaeb-bdec3ad8e5f0", invoice_number: "330351601", supplier: "ASKO", role: "fasit", note: "1 linje" },
  { invoice_id: "5dabe218-9528-483e-adc8-26a5ff864183", invoice_number: "1547621", supplier: "Idun", role: "fasit", note: "5 linjer, uten lagret varenummer" },
  { invoice_id: "c348a691-6e6b-4373-8f6b-64bfb7d576b6", invoice_number: "1515614", supplier: "Idun", role: "fasit", note: "7 linjer, uten lagret varenummer" },
  { invoice_id: "fdaf391b-d86d-4738-b705-cc161c5da26a", invoice_number: "9205342474", supplier: "Coca-Cola", role: "fasit", note: "17 linjer, 5 pantlinjer" },
  { invoice_id: "be7121b9-1130-4bc6-9ee3-d4759cc3afca", invoice_number: "9205352553", supplier: "Coca-Cola", role: "fasit", note: "12 linjer, uten lagret varenummer" },

  { invoice_id: "c4e3c972-882d-45c4-a0c0-fdb781c74d2d", invoice_number: "9204831293", supplier: "Coca-Cola", role: "vanskelig", note: "Linjesum ca. 12 % under – avgifter nederst?" },
  { invoice_id: "726dabf8-13b5-4d12-a133-607d9ab158f0", invoice_number: "1501126", supplier: "Idun", role: "vanskelig", note: "Sumavvik" },
  { invoice_id: "1520f173-039f-4311-8ab8-5fe0f48fd07b", invoice_number: "1509234", supplier: "Idun", role: "vanskelig", note: "Sumavvik" },
  { invoice_id: "f8b74566-3e3f-4f64-8def-270bb3a0b6cd", invoice_number: "9041322972", supplier: "Drammen Papir", role: "vanskelig", note: "Lang faktura – kuttes?" },
  { invoice_id: "9ea1cc12-8106-48a3-830b-4f51e058b7f7", invoice_number: "9041398810", supplier: "Drammen Papir", role: "vanskelig", note: "Lang faktura – kuttes?" },
  { invoice_id: "fcef7c6c-c587-4a6c-aabc-4932abc86af4", invoice_number: "330709218", supplier: "ASKO", role: "vanskelig", note: "Lang faktura – kuttes?" },
  { invoice_id: "f302201f-3125-4af4-b034-655bf7d5fa38", invoice_number: "330685033", supplier: "ASKO", role: "vanskelig", note: "Kreditnota" },
  { invoice_id: "dffd27f6-7f1b-4a3b-8c11-8f9cfa0ab95d", invoice_number: "526301", supplier: "PALS", role: "vanskelig", note: "Antall ×1000 – dokumentkontrollert fasit" },
  { invoice_id: "f28226ad-4452-4ebc-a1b2-01aa753428a1", invoice_number: "136003762", supplier: "Lantmännen Cerealia", role: "vanskelig", note: "Mva mangler i Tripletex-tallet" },

  { invoice_id: "03c94b74-197a-4fd4-a42f-27a268a47b66", invoice_number: "45936", supplier: "Flemming Egg", role: "uten_linjer", note: "Lagret uten linjer 30.10.2026" },
  { invoice_id: "e4864a73-f51a-49ba-8f63-bcf393eb0a9d", invoice_number: "140830", supplier: "Stangeland Mølle", role: "uten_linjer", note: "Lagret uten linjer 05.11.2026" },
  { invoice_id: "adbb014f-f21b-46c4-98a1-36ec5f674da3", invoice_number: "671183", supplier: "PALS", role: "uten_linjer", note: "Lagret uten linjer 02.11.2026" },
];

export function qualityTestEntry(invoiceId: unknown): QualityTestInvoice | null {
  return typeof invoiceId === "string" ? QUALITY_TEST_SET.find((e) => e.invoice_id === invoiceId) ?? null : null;
}

export const QUALITY_ROLE_LABEL: Record<QualityRole, string> = {
  fasit: "Fasit (godkjente linjer)",
  vanskelig: "Vanskelige",
  uten_linjer: "Uten linjer siden 19.10.2026",
};
