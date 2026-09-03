import { describe, it, expect } from "vitest";
import {
  selectTicketsNeedingAction,
  ticketsToDeskRows,
} from "@/ordre/hooks/useOrderDeskBoard";
import type { TicketQueueRow } from "@/ordre/hooks/useTickets";

const t = (over: Partial<TicketQueueRow>): TicketQueueRow => ({
  id: over.id ?? "1",
  subject: "Emne",
  sender_email: "kunde@eksempel.no",
  sender_name: "Kunde",
  received_at: "2026-01-01T10:00:00Z",
  status: "in_progress",
  priority: "normal",
  assigned_to: "user-1",
  related_order_id: null,
  ...over,
});

describe("selectTicketsNeedingAction", () => {
  it("tar med nye, haste/høy og uten ansvarlig — ikke rolige tildelte", () => {
    const rows = selectTicketsNeedingAction([
      t({ id: "calm" }),
      t({ id: "new", status: "new" }),
      t({ id: "urgent", priority: "urgent" }),
      t({ id: "unassigned", assigned_to: null }),
    ]);
    expect(rows.map((r) => r.id)).not.toContain("calm");
    expect(rows.map((r) => r.id).sort()).toEqual(["new", "unassigned", "urgent"]);
  });

  it("sorterer haster først", () => {
    const rows = selectTicketsNeedingAction([
      t({ id: "new", status: "new" }),
      t({ id: "urgent", priority: "urgent" }),
    ]);
    expect(rows[0].id).toBe("urgent");
  });
});

describe("ticketsToDeskRows", () => {
  it("lenker til ticket-detalj og merker prioritet", () => {
    const [row] = ticketsToDeskRows([t({ id: "x", priority: "urgent" })]);
    expect(row.to).toBe("/ordre/ticket/x");
    expect(row.badge).toBe("Haster");
    expect(row.tone).toBe("critical");
  });

  it("faller tilbake til «(uten emne)»", () => {
    const [row] = ticketsToDeskRows([t({ subject: "  " })]);
    expect(row.primary).toBe("(uten emne)");
  });
});
