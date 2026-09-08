import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { textComponentInheritance } from "./declaration-core.ts";

Deno.test("én koblet + én tekstkomponent: teksten arver forelderens næring og allergener", () => {
  const res = textComponentInheritance(true, ["milk"], ["nuts_hazelnut"], []);
  assertEquals(res.has_nutrition, true);
  assertEquals(res.allergens, ["milk"]);
  assertEquals(res.may_allergens, ["nuts_hazelnut"]);
});

Deno.test("komponentens egne allergener vinner over forelderens", () => {
  const res = textComponentInheritance(false, ["milk"], ["milk", "soybeans"], ["soybeans"]);
  assertEquals(res.has_nutrition, false);
  assertEquals(res.allergens, ["soybeans"]);
  assertEquals(res.may_allergens, ["milk"]);
});
