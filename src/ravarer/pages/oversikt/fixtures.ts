import type { WorkSummary, WorkItemsResult, ActivityFeed, PriceMovers } from "@/ravarer/lib/workRpcTypes";

export const FIXTURE_SUMMARY: WorkSummary = {
  invoice_access: true,
  supplier_items: { koblet: 0, ukoblet: 354, mangler_pakning: 173, prisavvik: 185, kontroll: 9, ikke_vare: 0 },
  invoices: {
    open_total: 110, missing_lines: 13, sum_mismatch: 39, needs_review: 0, ready_to_reconcile: 31,
    credit_notes_open: 0, flagged: 0, reconciled_total: 2000, reconciled_auto: 1500,
    reconciled_7d: 368, reconciled_auto_7d: 348, imported_7d: 400,
  },
  lines_to_review: null,
  approval: { ready_to_approve: 334, approved_total: 0 },
  data_quality: { missing_package: 173, unconfirmed_package: 220, unstable_price: 42,
    missing_declaration: 61, missing_nutrition: 48, datasheet_changes: 7, active_items: 1200 },
  other: { cases_open: 0, agreements_expiring_90d: 3, agreements_expiring_30d: 0, stock_below_min: 5, rematch_pending: 0 },
  todo_total: 804,
  generated_at: new Date().toISOString(),
};

export const FIXTURE_ITEMS: WorkItemsResult = {
  total: 804,
  counts: {
    alle: 804, kobling: 354, pakning: 173, pris: 185, kontroll: 9, fakturaer: 83,
    faktura_mangler_linjer: 13, faktura_sumavvik: 39, faktura_flagget: 0, faktura_klar: 31,
  },
  items: [
    {
      key: "varekort:idun:idun-combisur", grp: "pakning", type: "varekort", kind: "mangler_pakning",
      supplier_id: "s1", supplier_name: "Idun Industri AS", item_key: "sku:idun-combisur",
      invoice_id: null, invoice_number: null, title: "Idun Combisur Soft, sekk 20 kg",
      sku: "123456", rm_id: null, rm_name: null, open_lines: 7, open_invoices: 7,
      invoice_count: 7, amount: 27463, impact_nok: 27463, last_date: null, last_open_line_id: null, reasons: [],
    },
    {
      key: "fak:526301", grp: "fakturaer", type: "faktura", kind: "faktura_sumavvik",
      supplier_id: "s2", supplier_name: "A/S PALS", item_key: null,
      invoice_id: "inv-526301", invoice_number: "526301", title: "A/S PALS · faktura 526301",
      sku: null, rm_id: null, rm_name: null, open_lines: 0, open_invoices: 0,
      invoice_count: 1, amount: 12000, impact_nok: 1250, last_date: null, last_open_line_id: null,
      reasons: ["Sum stemmer ikke med linjene"],
    },
    {
      key: "varekort:pals:kardemomme", grp: "kobling", type: "varekort", kind: "ukoblet",
      supplier_id: "s2", supplier_name: "A/S PALS", item_key: "sku:kardemomme",
      invoice_id: null, invoice_number: null, title: "KARDEMOMME 1 HT VARMEBE.",
      sku: "9988", rm_id: null, rm_name: null, open_lines: 3, open_invoices: 2,
      invoice_count: 2, amount: 2100, impact_nok: 2100, last_date: null, last_open_line_id: null, reasons: [],
    },
  ],
  generated_at: new Date().toISOString(),
};

export const FIXTURE_ACTIVITY: ActivityFeed = {
  since: new Date(Date.now() - 7 * 86400000).toISOString(),
  items: [
    {
      id: "a1", at: new Date(Date.now() - 2 * 3600000).toISOString(), kind: "faktura_avstemt_auto",
      actor: "system", user_name: null, title: "Faktura avstemt automatisk",
      subject: "Idun Industri AS · faktura 1515614",
      detail: "Automatisk avstemt: alle linjer koblet, pris innenfor toleranse, sum dokumentert.",
      invoice_id: "inv-1515614", raw_material_id: null, count: 1,
    },
    {
      id: "a2", at: new Date(Date.now() - 5 * 3600000).toISOString(), kind: "pakning_bekreftet_auto",
      actor: "system", user_name: null, title: "Pakning bekreftet automatisk",
      subject: "Aro 2000 malt, kanne 14 kg",
      detail: "2 × 37,49 kr = 1 049,68 kr gir 14 kg per kanne.",
      invoice_id: null, raw_material_id: "rm-aro", count: 1,
    },
    {
      id: "a3", at: new Date(Date.now() - 12 * 3600000).toISOString(), kind: "forste_pris",
      actor: "system", user_name: null, title: "Første pris registrert",
      subject: "A/S PALS · faktura 521687",
      detail: "3 varer fikk sin første dokumenterte pris.",
      invoice_id: "inv-521687", raw_material_id: null, count: 3,
    },
  ],
  summary: { faktura_avstemt_auto: 24, pakning_bekreftet_auto: 7, forste_pris: 3, gjentatt_pris: 11 },
  generated_at: new Date().toISOString(),
};

export const FIXTURE_MOVERS: PriceMovers = {
  days: 30, from: null,
  summary: { changed: 23, up: 19, down: 4, suspicious: 1, effect_nok: 15062, effect_up_nok: 15062, effect_down_nok: 0 },
  items: [
    {
      raw_material_id: "rm-rosiner", rm_name: "Californiske rosiner select", base_unit: "kg",
      supplier_id: "s-pals", supplier_name: "A/S PALS", before_price: 44, before_date: "2026-09-10",
      now_price: 76.71, now_date: "2026-10-01", change_pct: 74.3, quantity: 400, effect_nok: 13084,
      suspicious: false, points: [{ date: "2026-09-20", price: 50 }, { date: "2026-10-01", price: 76.71 }],
    },
    {
      raw_material_id: "rm-potetstivelse", rm_name: "Hoff potetstivelse 25 kg", base_unit: "kg",
      supplier_id: "s-hoff", supplier_name: "Hoff", before_price: 27, before_date: "2026-09-12",
      now_price: 40.38, now_date: "2026-10-03", change_pct: 49.6, quantity: 25, effect_nok: 334,
      suspicious: false, points: [{ date: "2026-09-20", price: 32 }, { date: "2026-10-03", price: 40.38 }],
    },
    {
      raw_material_id: "rm-kardemomme", rm_name: "Kardemomme grov 5 kg", base_unit: "kg",
      supplier_id: "s-pals", supplier_name: "A/S PALS", before_price: 705.55, before_date: "2026-09-05",
      now_price: 726.72, now_date: "2026-10-02", change_pct: 3.0, quantity: 20, effect_nok: 423,
      suspicious: false, points: [{ date: "2026-09-15", price: 712 }, { date: "2026-10-02", price: 726.72 }],
    },
  ],
  generated_at: new Date().toISOString(),
};
