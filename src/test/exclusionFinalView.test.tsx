import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { nextInvoiceStep, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { finalLockNote, isExcludedInvoice } from "@/ravarer/pages/priskontroll/faktura/exclusionView";
import { parseVisning } from "@/ravarer/pages/priskontroll/fakturaer/visning";

vi.mock("@/fakturaer/hooks/useInvoiceDocumentUrl", () => ({ useInvoiceDocumentUrl: () => ({ url: null }) }));
import { WorkspaceHeader } from "@/ravarer/pages/priskontroll/faktura/WorkspaceHeader";

const base = {
  status: "excluded", is_credit_note: true, creditNoteUnlinked: true, lines_sum_status: "mismatch", open_count: 3,
  line_count: 3, line_extraction_status: "done", source: "tripletex", canReconcile: false, reconcileBlockedReason: null,
  canWrite: true, canReconcileRight: true, canApprove: true, approved: false, costPosted: false,
} as unknown as NextStepInput;

describe("holdt utenfor: avsluttet visning", () => {
  it("neste steg er ingen kreditnota-, sum- eller avklaringshandling", () => {
    const n = nextInvoiceStep(base);
    expect(n.key).toBe("holdt_utenfor");
    expect(n.enabled).toBe(false);
    expect(n.hint).not.toMatch(/ikke koblet/);
    expect(nextInvoiceStep({ ...base, status: "needs_review" }).key).toBe("koble_kreditnota");
  });

  it("låsetekst skiller holdt utenfor fra flagget og avstemt", () => {
    expect(finalLockNote("excluded", "2026-10-14T08:13:00Z")).toBe("Holdt utenfor råvarebehandling — linjene er låst");
    expect(finalLockNote("needs_review", "2026-10-14T08:13:00Z")).toBe("Holdt utenfor råvarebehandling — linjene er låst");
    expect(finalLockNote("flagged", null)).toBe("Fakturaen er flagget — linjene er låst");
    expect(finalLockNote("reconciled", null)).toBe("Fakturaen er avstemt — linjene er låst");
    expect(finalLockNote("needs_review", null)).toBeNull();
    expect(isExcludedInvoice("excluded", null)).toBe(true);
  });

  it("header viser ingen primærhandling for holdt utenfor", () => {
    render(
      <MemoryRouter>
        <WorkspaceHeader backHref="/" supplier="Idun" invoiceNumber="8050625" invoiceDate="2026-09-01" amount={-1000}
          status="excluded" reconciledMode={null} steps={[]} isCreditNote next={nextInvoiceStep(base)} busy={false}
          onPrimary={vi.fn()} undoLabel={null} onUndo={vi.fn()} docPath={null} docOpen={false} onToggleDoc={vi.fn()}
          canWrite canFetch={false} rematchBusy={false} onMenu={vi.fn()} sumMismatch />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /Koble kreditnota/ })).toBeNull();
    expect(document.querySelector("[data-primary-action]")).toBeNull();
    expect(screen.getByText(/holdt utenfor råvarebehandling/i)).toBeTruthy();
  });

  it("fakturalistens filter «Holdt utenfor» tolkes fra URL", () => {
    expect(parseVisning(new URLSearchParams("visning=utenfor")).visning).toBe("utenfor");
  });
});
