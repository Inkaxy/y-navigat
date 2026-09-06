import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { validateOutcomes, type NegotiationItemRow, type RecipientRow, type ResponseRow } from "./validate.ts";

const negotiationId = "neg-1";
const items: NegotiationItemRow[] = [
  { id: "item-1", negotiation_id: negotiationId, raw_material_id: "rm-1", base_unit: "kg" },
];
const recipients: RecipientRow[] = [{ id: "rec-1", negotiation_id: negotiationId, supplier_id: "sup-1" }];
const responses: ResponseRow[] = [{ id: "resp-1", negotiation_item_id: "item-1", recipient_id: "rec-1" }];

function run(outcomes: unknown[]) {
  return validateOutcomes({ outcomes, items, recipients, responses, negotiationId });
}

Deno.test("gyldig avtale regnes om til pris per baseenhet", () => {
  const { errors, prepared } = run([
    {
      negotiation_item_id: "item-1",
      winner_recipient_id: "rec-1",
      winner_response_id: "resp-1",
      agreed_price: 250,
      agreed_package_size: 25,
      agreed_package_unit: "kg",
      apply_to_supplier: true,
    },
  ]);
  assertEquals(errors, []);
  assertEquals(prepared[0].agreed_price_per_base_unit, 10);
});

Deno.test("ugyldig pris skriver ingen tom avtale", () => {
  for (const price of ["abc", Number.NaN, null, undefined, ""]) {
    const { errors, prepared } = run([
      {
        negotiation_item_id: "item-1",
        winner_recipient_id: "rec-1",
        agreed_price: price,
        agreed_package_size: 25,
        agreed_package_unit: "kg",
        apply_to_supplier: true,
      },
    ]);
    assertEquals(errors.length > 0, true, `pris ${String(price)}`);
    assertEquals(prepared.length, 0);
  }
});

Deno.test("negativ pris avvises", () => {
  const { errors } = run([
    { negotiation_item_id: "item-1", winner_recipient_id: "rec-1", agreed_price: -5, apply_to_supplier: true },
  ]);
  assertEquals(errors.length > 0, true);
});

Deno.test("avtale uten valgt leverandør avvises", () => {
  const { errors, prepared } = run([
    {
      negotiation_item_id: "item-1",
      agreed_price: 250,
      agreed_package_size: 25,
      agreed_package_unit: "kg",
      apply_to_supplier: true,
    },
  ]);
  assertEquals(errors.length > 0, true);
  assertEquals(prepared.length, 0);
});

Deno.test("fremmede ID-er avvises", () => {
  assertEquals(run([{ negotiation_item_id: "ukjent", apply_to_supplier: false }]).errors.length, 1);
  assertEquals(
    run([{ negotiation_item_id: "item-1", winner_recipient_id: "rec-fremmed", apply_to_supplier: false }]).errors.length,
    1,
  );
  assertEquals(
    run([{ negotiation_item_id: "item-1", winner_recipient_id: "rec-1", winner_response_id: "resp-fremmed" }]).errors
      .length,
    1,
  );
});

Deno.test("uten apply_to_supplier lagres utfallet uten prisomregning", () => {
  const { errors, prepared } = run([
    { negotiation_item_id: "item-1", winner_recipient_id: "rec-1", agreed_price: null, apply_to_supplier: false },
  ]);
  assertEquals(errors, []);
  assertEquals(prepared[0].agreed_price_per_base_unit, null);
  assertEquals(prepared[0].set_as_primary, false);
});

Deno.test("RFQ-pris er per grunnenhet og deles ikke på pakningen", () => {
  // Leverandørportalen ber om «Pris pr kg», så 100 kr/kg med 25 kg sekk er 100 kr/kg.
  const { errors, prepared } = run([
    {
      negotiation_item_id: "item-1",
      winner_recipient_id: "rec-1",
      winner_response_id: "resp-1",
      agreed_price: 100,
      agreed_price_unit: "kg",
      agreed_package_size: 25,
      agreed_package_unit: "kg",
      apply_to_supplier: true,
    },
  ]);
  assertEquals(errors, []);
  assertEquals(prepared[0].agreed_price_per_base_unit, 100);
});

Deno.test("pris oppgitt per gram regnes om til baseenheten kg", () => {
  const { prepared } = run([
    {
      negotiation_item_id: "item-1",
      winner_recipient_id: "rec-1",
      agreed_price: 0.1,
      agreed_price_unit: "g",
      agreed_package_size: 25,
      agreed_package_unit: "kg",
      apply_to_supplier: true,
    },
  ]);
  assertEquals(Math.round((prepared[0].agreed_price_per_base_unit ?? 0) * 100) / 100, 100);
});
