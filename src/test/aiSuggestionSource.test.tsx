// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiSuggestionCard } from "@/fakturaer/components/AiSuggestionCard";
import { parseAiSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import { buildSuggestUserText } from "../../supabase/functions/_shared/lineSuggestion.ts";

const base = { decision: "unclear", line_class: "vare", evidence: [{ field: "beskrivelse", value: "Smoothiebeger", source: "faktura" }], missing: [], rejected: [], uncertainties: [], model: "m", candidate_count: 0 };

describe("AI-forslagets kilde", () => {
  it("prompten kaller ikke registrert linje for dokumentet", () => {
    const t = buildSuggestUserText({ line: {}, candidates: [], known: [], categories: [], corrections: [], isCreditNote: false, currency: "NOK" } as never);
    expect(t).not.toContain("(fra dokumentet)");
    expect(t).toContain("originalen er ikke kontrollert");
  });
  it("manglende kilde = registrert linje, aldri «lest fra originalen»", () => {
    const s = parseAiSuggestion(base);
    expect(s?.sourceStatus).toBe("registrert_linje");
    render(<AiSuggestionCard suggestion={s!} rawMaterialName={null} canWrite={false} />);
    expect(screen.getByText("Forslag basert på registrert linje, original ikke kontrollert.")).toBeTruthy();
    expect(screen.queryByText("Lest fra originalen")).toBeNull();
    expect(screen.queryByText("Lest fra fakturaen")).toBeNull();
  });
});
