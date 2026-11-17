import { describe, expect, it } from "vitest";
import { outsideCostOn, parseAutoSettings, parseStale, ruleSentences, setOutsideCost, toggleRule } from "@/ravarer/lib/automatikk";
import { draftFrom } from "@/ravarer/lib/priceSettingsDraft";

const draft = draftFrom({
  default_price_tolerance_pct: 3, fuzzy_match_threshold: null, fuzzy_auto_match_threshold: null, fuzzy_auto_match_dominance_threshold: null,
  auto_approve_within_tolerance: false, auto_reconcile_clean_imports: true, use_first_confirmed_price_as_start: false, auto_check_against_start_price: false,
  auto_check_against_last_purchase: true, start_price_tolerance_pct: null, start_price_max_impact_nok: null, price_min_impact_nok: 50, price_hard_cap_pct: 15,
  auto_accept_first_price: true, auto_confirm_inferred_package: true, auto_exclude_line_kinds: ["frakt", "gebyr", "avrunding", "rabatt"],
}, []);

describe("Automatikk: regler som setninger", () => {
  it("setningene bruker lagrede grenser (3 %, 15 %, 50 kr)", () => {
    const s = ruleSentences(draft).find((r) => r.key === "autoApprove")!;
    expect(s.title).toBe("Prisøkning innenfor 3 % godtas uten deg.");
    expect(s.detail).toContain("15 %");
    expect(s.detail).toContain("50 kr");
    expect(s.on).toBe(false);
  });
  it("«ny vare godkjennes av deg» er det motsatte av automatisk førstepris", () => {
    expect(ruleSentences(draft).find((r) => r.key === "firstPriceByYou")!.on).toBe(false);
    expect(toggleRule(draft, "firstPriceByYou", true)).toEqual({ firstPrice: false });
  });
  it("frakt/gebyr/avrunding slås av og på sammen, rabatt beholdes, pant aldri", () => {
    expect(outsideCostOn(draft.kinds)).toBe(true);
    expect(setOutsideCost(draft.kinds, false)).toEqual(["rabatt"]);
    expect(setOutsideCost(["pant", "rabatt"], true)).toEqual(["rabatt", "frakt", "gebyr", "avrunding"]);
  });
});

describe("Automatikk: nye innstillinger", () => {
  it("tom rad = standard: pant følger varen, automatisk kø av, 25 om gangen, 3 dager", () => {
    expect(parseAutoSettings([])).toEqual({ depositFollows: true, requeueOn: false, batch: 25, minAgeDays: 3 });
    expect(parseAutoSettings([{ deposit_as_follow_item: null, auto_requeue_stale_enabled: true, auto_requeue_batch_size: 10 }])).toEqual({ depositFollows: true, requeueOn: true, batch: 10, minAgeDays: 3 });
    expect(parseAutoSettings({})).toBeNull();
  });
  it("kø-svar leses strengt", () => {
    expect(parseStale({ ok: true, dry_run: true, invoices: [{ id: "a", invoice_number: "1" }], limit: 25, min_age_days: 3 }).kind).toBe("ok");
    expect(parseStale({ ok: true, invoices: [] }).kind).toBe("unknown");
  });
});
