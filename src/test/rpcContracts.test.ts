import { describe, it, expect, expectTypeOf } from "vitest";
import type { CountLinePayload } from "@/ravarer/lib/rpcContracts";

describe("rpcContracts", () => {
  it("expected_base er et tall, ikke null", () => {
    expectTypeOf<CountLinePayload["expected_base"]>().toEqualTypeOf<number>();
    const payload: CountLinePayload = { raw_material_id: "a", counted_base: 1, expected_base: 5 };
    expect(payload.expected_base).toBe(5);
  });
});
