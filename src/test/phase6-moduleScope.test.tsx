// @vitest-environment jsdom
/** Presentasjonelt modul-omfang (`data-active-app`): eierskap, nesting, bytte og avmontering; Råvarer-CSS-regler. */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";
import { ModuleScope } from "@/providers/ModuleScope";
import { __resetModuleScope, claimActiveApp } from "@/providers/moduleScopeStore";
import RegnestykkePreviewContent from "@/dev/RegnestykkePreviewContent";

const attr = () => document.documentElement.getAttribute("data-active-app");
beforeEach(() => { cleanup(); __resetModuleScope(); });

describe("ModuleScope", () => {
  it("setter og fjerner ved avmontering", () => {
    const r = render(<ModuleScope appCode="ravarer"><span /></ModuleScope>);
    expect(attr()).toBe("ravarer");
    r.unmount();
    expect(attr()).toBeNull();
  });
  it("nestet omfang vinner uavhengig av effekt-rekkefølge, og ytre gjenopprettes", () => {
    const r = render(<ModuleScope appCode="nbhub"><ModuleScope appCode="ravarer"><span /></ModuleScope></ModuleScope>);
    expect(attr()).toBe("ravarer");
    r.rerender(<ModuleScope appCode="nbhub"><span /></ModuleScope>);
    expect(attr()).toBe("nbhub");
  });
  it("bytte av app fjerner Råvarer-omfanget", () => {
    const r = render(<ModuleScope appCode="ravarer"><span /></ModuleScope>);
    r.rerender(<ModuleScope appCode="faktura"><span /></ModuleScope>);
    expect(attr()).toBe("faktura");
  });
  it("en instans fjerner bare eget token", () => {
    const a = claimActiveApp("ravarer", 1);
    const b = claimActiveApp("pos_styring", 1);
    expect(attr()).toBe("pos_styring");
    a();
    expect(attr()).toBe("pos_styring");
    b();
    expect(attr()).toBeNull();
  });
  it("inert regnestykke-demo går inn i Råvarer-omfanget og rydder ved avmontering; portalert dialog ligger under <html>", async () => {
    const r = render(<RegnestykkePreviewContent />);
    expect(attr()).toBe("ravarer");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Åpne regnestykket" })); });
    expect(document.documentElement.contains(screen.getByRole("dialog"))).toBe(true);
    r.unmount();
    expect(attr()).toBeNull();
  });
});

describe("Råvarer-fargeregler", () => {
  const css = readFileSync("src/index.css", "utf8");
  it("primær og eyebrow overstyres bare under data-active-app=ravarer", () => {
    expect(css).toMatch(/html\[data-active-app="ravarer"\] \{[^}]*--primary: var\(--text-primary\);[^}]*--primary-foreground: var\(--surface-canvas\);/);
    expect(css).toMatch(/html\.dark\[data-active-app="ravarer"\] \{[^}]*--rm-eyebrow-ink: var\(--brand-bronze-soft\);/);
    expect(css).toMatch(/html\[data-active-app="ravarer"\] \[data-page-eyebrow\]/);
    // app-fargen selv endres ikke (dekor beholdes)
    expect(css).not.toMatch(/data-active-app="ravarer"\][^{]*\{[^}]*--app-color:/);
  });
  it("Råvarer-lenker bruker semantisk primær, ikke lys app-farge som tekst", () => {
    const files = ["src/ravarer/components/CostDeviationsCard.tsx", "src/ravarer/components/CostSourceInfo.tsx", "src/ravarer/components/PriceTimeline.tsx",
      "src/ravarer/components/PriceEventsList.tsx", "src/ravarer/components/PriceComparisonView.tsx", "src/ravarer/components/tabs/HistoryTab.tsx",
      "src/ravarer/components/tabs/RecipesTab.tsx", "src/ravarer/components/detail/Completeness.tsx", "src/fakturaer/components/invoice-detail/InvoiceLinesTable.tsx"];
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\btext-app\b/);
  });
});
