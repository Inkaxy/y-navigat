// @vitest-environment jsdom
/** Delte celler (tabell + mobilkort): ukjent er aldri et tall eller rødt avvik; handling til faktisk faktura. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComparisonCell, CostStatusMark } from "@/ravarer/components/vareliste/PriceCells";
import { PENDING_LOADING } from "@/ravarer/lib/listPriceEvidence";

const wrap = (n: React.ReactNode) => render(<MemoryRouter><TooltipProvider>{n}</TooltipProvider></MemoryRouter>);

describe("ComparisonCell", () => {
  it("ukjent (ALI) viser grunn og «Kontroller faktura» med faktisk ID, ingen prosent", () => {
    wrap(<ComparisonCell comparison={{ state: "unknown", label: "Kostprisen er ikke verifisert", needsControl: true, invoiceId: "874d1628", invoiceDate: "2026-07-29", checkedAt: "2026-10-11T12:00:00Z" }} baseUnit="stk" tolerance={3} hardCap={15} />);
    expect(screen.getByText("Kostprisen er ikke verifisert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kontroller faktura" }).getAttribute("href")).toContain("/priskontroll/faktura/874d1628");
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("verifisert 0 % vises som 0 %", () => {
    wrap(<ComparisonCell comparison={{ state: "eligible", deviation: 0, invoicePpbu: 60.6035, invoiceDate: "2026-08-18", invoiceNumber: "1", invoiceId: "i", checkedAt: "2026-10-11T12:00:00Z" }} baseUnit="kg" tolerance={3} hardCap={15} />);
    expect(screen.getByText(/0 %/)).toBeInTheDocument();
  });
  it("laster: ingen tall", () => {
    wrap(<ComparisonCell comparison={PENDING_LOADING} baseUnit="kg" tolerance={3} hardCap={15} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("uverifisert kost merkes; verifisert har ikke merke", () => {
    const { rerender } = wrap(<CostStatusMark status="uverifisert" />);
    expect(screen.getByText("Ikke verifisert")).toBeInTheDocument();
    rerender(<MemoryRouter><TooltipProvider><CostStatusMark status="verifisert" /></TooltipProvider></MemoryRouter>);
    expect(screen.queryByText("Ikke verifisert")).toBeNull();
  });
});
