import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiSuggestionCard } from "@/fakturaer/components/AiSuggestionCard";
import { parseAiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import { buildSuggestUserText } from "../../supabase/functions/_shared/lineSuggestion.ts";

describe("AI-forslagets kilde", () => {
  it("prompten kaller ikke registrert linje for dokumentet", () => {
    const t = buildSuggestUserText({ line: {}, candidates: [], known: [], categories: [], corrections: [], isCreditNote: false, currency: "NOK" } as never);
    expect(t).not.toContain("(fra dokumentet)");
    expect(t).toContain("originalen er ikke kontrollert");
  });
});
