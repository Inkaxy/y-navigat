import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { validateSubmission } from "./validate.ts";

const negotiation = { id: "neg-1", status: "in_progress", response_deadline: "2026-12-01T12:00:00Z" };
const items = [
  { id: "item-1", negotiation_id: "neg-1" },
  { id: "item-2", negotiation_id: "neg-1" },
];
const now = new Date("2026-09-08T10:00:00Z");

Deno.test("godtar egne varelinjer innenfor fristen", () => {
  const r = validateSubmission({ negotiation, items, responses: [{ negotiation_item_id: "item-2" }], now });
  assertEquals(r, null);
});

Deno.test("avviser varelinje fra en annen forhandling", () => {
  const r = validateSubmission({
    negotiation,
    items: [...items, { id: "item-x", negotiation_id: "neg-2" }],
    responses: [{ negotiation_item_id: "item-x" }],
    now,
  });
  assertEquals(r?.code, "item_not_in_negotiation");
  assertEquals(r?.status, 403);
});

Deno.test("avviser ukjent varelinje", () => {
  const r = validateSubmission({ negotiation, items, responses: [{ negotiation_item_id: "tull" }], now });
  assertEquals(r?.code, "item_not_in_negotiation");
});

Deno.test("avviser svar etter passert frist", () => {
  const r = validateSubmission({
    negotiation: { ...negotiation, response_deadline: "2026-09-01T12:00:00Z" },
    items,
    responses: [{ negotiation_item_id: "item-1" }],
    now,
  });
  assertEquals(r?.code, "deadline_passed");
  assertEquals(r?.status, 409);
});

Deno.test("avviser svar når forhandlingen er avsluttet", () => {
  const r = validateSubmission({
    negotiation: { ...negotiation, status: "concluded" },
    items,
    responses: [{ negotiation_item_id: "item-1" }],
    now,
  });
  assertEquals(r?.code, "negotiation_closed");
});
