import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualityTestCard } from "@/ravarer/pages/innstillinger/QualityTestCard";

describe("Kvalitetstest-kortet", () => {
  it("viser én startknapp og testsettet før noe er kjørt", () => {
    render(<QualityTestCard />);
    expect(screen.getByRole("button", { name: "Start kvalitetstest" })).toBeEnabled();
    expect(screen.getByText("Testsettet (22 fakturaer)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eksporter resultat/ })).toBeDisabled();
  });
});
