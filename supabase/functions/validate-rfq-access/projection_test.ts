import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FORBIDDEN_ITEM_FIELDS,
  LIVE_ITEM_SELECT,
  RFQ_ITEM_SELECT,
  projectLiveItems,
  projectRfqItems,
  projectRfqResponses,
} from "../_shared/negotiation-projection.ts";

Deno.test("RFQ-projeksjonen slipper ikke interne kost- eller margintall videre", () => {
  const [row] = projectRfqItems([{
    id: "i1",
    raw_material_id: "rm1",
    expected_annual_volume: 1200,
    expected_annual_volume_unit: "kg",
    suggested_package_size: 25,
    suggested_package_unit: "kg",
    actual_cost_baseline: 18.5,
    target_price: 16,
    internal_note: "gå ikke over 17",
    margin_pct: 42,
    raw_materials: { name: "Hvetemel", base_unit: "kg", package_size: 25, package_unit: "kg" },
  }]);
  for (const f of FORBIDDEN_ITEM_FIELDS) {
    assert(!(f in row), `${f} lekket ut i RFQ-svaret`);
  }
  assertEquals(row.expected_annual_volume, 1200);
  assertEquals(row.raw_materials?.name, "Hvetemel");
});

Deno.test("Bekreftelsesportalen får bare avtalte felter", () => {
  const [row] = projectLiveItems([{
    id: "i2",
    raw_material_id: "rm2",
    live_agreed_price: 14.25,
    live_agreed_price_unit: "kg",
    live_agreed_package_size: 10,
    live_agreed_package_unit: "kg",
    live_agreed_contract_months: 12,
    live_agreed_min_volume: 500,
    live_agreed_min_volume_unit: "kg",
    live_status: "tentatively_agreed",
    actual_cost_baseline: 20,
    walk_away_price: 15,
    buyer_notes: "internt",
    raw_materials: { name: "Smør", base_unit: "kg", package_size: 25, package_unit: "kg" },
  }]);
  for (const f of FORBIDDEN_ITEM_FIELDS) {
    assert(!(f in row), `${f} lekket ut i bekreftelsessvaret`);
  }
  // Pakningsdata på råvaren er ikke relevant i bekreftelsen og tas ikke med.
  assertEquals(Object.keys(row.raw_materials ?? {}).sort(), ["base_unit", "name"]);
  assertEquals(row.live_agreed_price, 14.25);
});

Deno.test("SELECT-listene ber aldri om interne felter", () => {
  for (const f of FORBIDDEN_ITEM_FIELDS) {
    assert(!RFQ_ITEM_SELECT.includes(f), `${f} i RFQ_ITEM_SELECT`);
    assert(!LIVE_ITEM_SELECT.includes(f), `${f} i LIVE_ITEM_SELECT`);
  }
  assert(!RFQ_ITEM_SELECT.includes("*"));
  assert(!LIVE_ITEM_SELECT.includes("*"));
});

Deno.test("Leverandørens egne svar beholder alle skjemafelter", () => {
  const [row] = projectRfqResponses([{
    negotiation_item_id: "i1",
    offered_price: 15.5,
    notes: "levering uke 40",
    status: "draft",
    internal_note: "hemmelig",
  }]);
  assertEquals(row.offered_price, 15.5);
  assertEquals(row.notes, "levering uke 40");
  assert(!("internal_note" in row));
});
