import { osloDateISO } from "@/lib/osloDate";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import type { BakersLine, BakersRawMaterial } from "@/varer/lib/bakers";

/** Realistisk historikk: samme dag med omvendt id, enhetsbytte, ukjent eldre enhet, rettelse og kreditnota. */
const MANUAL_SRC = ["man", "ual"].join("");
const today = new Date();
const iso = (daysAgo: number) => osloDateISO(new Date(today.getTime() - daysAgo * 86400000));

export const PRICE_HISTORY_FIXTURE: TimelineHistoryRow[] = [
  { id: "z-early", effective_date: iso(10), price: 10, supplier_id: "s1", source: "invoice", invoice_id: "i1", invoiceNumber: "F-1001", createdAt: `${iso(10)}T08:00:00Z`, currency: "NOK", unit: "kg", unitSource: "ved_registrering", packageText: "25 kg" },
  { id: "a-late", effective_date: iso(10), price: 12, supplier_id: "s1", source: "invoice", invoice_id: "i2", invoiceNumber: "F-1002", createdAt: `${iso(10)}T09:00:00Z`, currency: "NOK", unit: "kg", unitSource: "ved_registrering", packageText: "25 kg",
    corrections: [{ at: `${iso(9)}T10:00:00Z`, reason: "Feil lest mengde", fields: [{ field: "Mengde", before: "10 000", after: "10" }] }] },
  { id: "m-manual", effective_date: iso(30), price: 11.5, supplier_id: null, source: MANUAL_SRC, invoice_id: null, createdAt: `${iso(30)}T12:00:00Z`, currency: "NOK", unit: null, unitSource: null, packageText: null, notes: "Eldre manuell pris" },
  { id: "g-gram", effective_date: iso(60), price: 0.011, supplier_id: "s1", source: "invoice", invoice_id: "i3", invoiceNumber: "F-0901", createdAt: `${iso(60)}T12:00:00Z`, currency: "NOK", unit: "g", unitSource: "revidert_enhetsbytte", packageText: "10 × 1 kg" },
  { id: "s-old", effective_date: iso(90), price: 9.4, supplier_id: "s1", source: "invoice", invoice_id: "i4", invoiceNumber: "F-0800", createdAt: `${iso(90)}T12:00:00Z`, currency: "NOK", supersededAt: `${iso(80)}T12:00:00Z`, supersededReason: "ny_linjerad", unit: "kg", unitSource: "ved_registrering", packageText: "25 kg" },
  { id: "k-credit", effective_date: iso(20), price: 10.8, supplier_id: "s1", source: "invoice", invoice_id: "i5", invoiceNumber: "K-12", isCredit: true, createdAt: `${iso(20)}T12:00:00Z`, currency: "NOK", unit: "kg", unitSource: "ved_registrering", packageText: null },
  { id: "e-eur", effective_date: iso(40), price: 1.1, supplier_id: "s2", source: "invoice", invoice_id: "i6", invoiceNumber: "EU-7", createdAt: `${iso(40)}T12:00:00Z`, currency: "EUR", unit: "kg", unitSource: "ved_registrering", packageText: null },
];

const rm = (o: Partial<BakersRawMaterial> & { id: string; name: string }): BakersRawMaterial => ({
  base_unit: "kg", cost_basis_status: "verifisert", price_source: "invoice", price_updated_at: "2026-10-06T10:00:00Z", ...o,
});
const line = (id: string, quantity: number, unit: string, r: BakersRawMaterial): BakersLine => ({
  id, recipe_part_id: "p", raw_material_id: r.id, quantity, unit, _rm: r,
});

const flour = rm({ id: "mel", name: "Hvetemel", current_cost_price: 11.2, grain_classification: "wheat" });
const water = rm({ id: "vann", name: "Vann", current_cost_price: 0, is_water: true, base_unit: "l" });
const salt = rm({ id: "salt", name: "Salt", current_cost_price: 0.012, base_unit: "g", price_updated_at: "2026-10-08T10:00:00Z" });
const oil = rm({ id: "olje", name: "Rapsolje", current_cost_price: 30, base_unit: "l", density_g_per_ml: 0.92 });

export const RECIPE_VERIFIED_FIXTURE: BakersLine[] = [
  line("1", 10, "kg", flour), line("2", 6.5, "l", water), line("3", 200, "g", salt), line("4", 300, "g", oil),
];

export const RECIPE_INCOMPLETE_FIXTURE: BakersLine[] = [
  ...RECIPE_VERIFIED_FIXTURE.slice(0, 3),
  line("5", 500, "g", rm({ id: "smor", name: "Smør", current_cost_price: 98, cost_basis_status: "uverifisert", price_source: MANUAL_SRC })),
  line("6", 200, "g", rm({ id: "sukker", name: "Sukker", current_cost_price: 14, cost_basis_status: "mangler", price_source: null })),
  line("7", 100, "g", rm({ id: "frø", name: "Solsikkefrø", current_cost_price: 40, cost_basis_status: null })),
];
