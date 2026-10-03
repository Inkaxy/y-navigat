import { describe, expect, it } from "vitest";
import { canAcceptPriceVariance } from "@/fakturaer/lib/queueActions";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const line = (o: Partial<ReviewLineRow>): ReviewLineRow =>
  ({ id: "l", review_reason: "price_variance", requires_review: true, variance_status: "over", raw_material_id: "rm",
     price_per_base_unit: 35.54, expected_price_per_base_unit: 23.82, quantity: 6, invoice: null, ...o }) as unknown as ReviewLineRow;

describe("canAcceptPriceVariance", () => {
  it("rent prisavvik kan godtas", () => expect(canAcceptPriceVariance(line({}))).toBe(true));
  it("ikke uten sammenligningspris", () => expect(canAcceptPriceVariance(line({ expected_price_per_base_unit: null }))).toBe(false));
  it("ikke uten beregnet pris", () => expect(canAcceptPriceVariance(line({ price_per_base_unit: null }))).toBe(false));
  it("ikke med pakningsårsak", () => expect(canAcceptPriceVariance(line({ review_reason: "price_variance,unknown_package_size" }))).toBe(false));
  it("ikke uten årsak", () => expect(canAcceptPriceVariance(line({ review_reason: null }))).toBe(false));
});
