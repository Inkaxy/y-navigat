import { describe, it, expect } from "vitest";
import { linkBadgeLabel } from "@/fakturaer/components/StartPricePanel";
import type { StartPriceEligibility } from "@/fakturaer/lib/startPrice";

function eligibility(over: Partial<StartPriceEligibility>): StartPriceEligibility {
  return {
    eligible: true,
    blockers: [],
    line_id: "l1",
    invoice_id: "i1",
    invoice_number: "F-1",
    invoice_date: "2026-09-01",
    currency: "NOK",
    total_amount: 1000,
    base_quantity: 10,
    base_unit: "kg",
    package_size: 25,
    package_unit: "kg",
    price_per_base_unit: 100,
    existing_start_price: null,
    ...over,
  } as StartPriceEligibility;
}

/** Merkelappen skal aldri påstå at koblingen er bekreftet når serveren sier noe annet. */
describe("startpris-panelet: merkelapp for koblingen", () => {
  it("viser «Bekreftet kobling» kun når linjen kvalifiserer", () => {
    expect(linkBadgeLabel(eligibility({}))).toBe("Bekreftet kobling");
  });

  it("viser «Kobling må bekreftes» når serveren sier at koblingen ikke er manuell", () => {
    expect(
      linkBadgeLabel(eligibility({ eligible: false, blockers: ["koblingen_er_ikke_manuelt_bekreftet"] })),
    ).toBe("Kobling må bekreftes");
  });

  it("viser «Til kontroll» ved andre sperrer", () => {
    expect(linkBadgeLabel(eligibility({ eligible: false, blockers: ["ukjent_pakning"] }))).toBe("Til kontroll");
  });
});
