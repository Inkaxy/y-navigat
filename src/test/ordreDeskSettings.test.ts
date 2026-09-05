import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDRE_DESK_SETTINGS,
  parseOrdreDeskSettings,
} from "@/ordre/hooks/useOrdreDeskSettings";
import { confidenceLevel } from "@/ordre/lib/aiConfidence";

describe("ordrekontor-innstillinger", () => {
  it("bruker standardverdiene når ingenting er lagret", () => {
    expect(parseOrdreDeskSettings(null)).toEqual(DEFAULT_ORDRE_DESK_SETTINGS);
    expect(parseOrdreDeskSettings("tull")).toEqual(DEFAULT_ORDRE_DESK_SETTINGS);
  });

  it("overstyrer lagrede verdier", () => {
    const s = parseOrdreDeskSettings({
      refundApprovalLimit: 1500,
      forwardSignature: "Mvh Kari",
      confidenceHigh: 0.9,
      confidenceMedium: 0.5,
      maxAttachmentMb: 10,
    });
    expect(s.refundApprovalLimit).toBe(1500);
    expect(s.forwardSignature).toBe("Mvh Kari");
    expect(s.confidenceHigh).toBe(0.9);
    expect(s.confidenceMedium).toBe(0.5);
    expect(s.maxAttachmentMb).toBe(10);
  });

  it("faller tilbake ved ugyldige verdier og holder middels under høy", () => {
    const s = parseOrdreDeskSettings({
      refundApprovalLimit: -5,
      forwardSignature: "   ",
      confidenceHigh: 0.7,
      confidenceMedium: 0.95,
      maxAttachmentMb: 9999,
    });
    expect(s.refundApprovalLimit).toBe(DEFAULT_ORDRE_DESK_SETTINGS.refundApprovalLimit);
    expect(s.forwardSignature).toBe(DEFAULT_ORDRE_DESK_SETTINGS.forwardSignature);
    expect(s.confidenceMedium).toBe(0.7);
    expect(s.maxAttachmentMb).toBe(DEFAULT_ORDRE_DESK_SETTINGS.maxAttachmentMb);
  });

  it("konfidensgrensene styrer nivået", () => {
    expect(confidenceLevel(0.8)).not.toBe("high");
    expect(confidenceLevel(0.8, { high: 0.75, medium: 0.5 })).toBe("high");
  });
});
