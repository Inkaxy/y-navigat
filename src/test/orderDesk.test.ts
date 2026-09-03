import { describe, it, expect } from "vitest";
import {
  MUST_HANDLE_ROWS_PER_GROUP,
  buildMustHandleGroups,
  ordersToDeskRows,
  recurringToDeskRows,
  selectTicketsNeedingAction,
  ticketsToDeskRows,
  totalOfGroups,
} from "@/ordre/hooks/useOrderDeskBoard";
import type { TicketQueueRow } from "@/ordre/hooks/useTickets";
import type { OrderListRow } from "@/ordre/hooks/useOrders";
import { formatLastUpdated, formatNorwegianToday } from "@/ordre/lib/deskHeaderFormat";

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

const o = (over: Partial<OrderListRow>): OrderListRow => ({
  id: over.id ?? "o1",
  order_number: "10001",
  status: "awaiting_confirmation",
  order_kind: "dated",
  approval_reason: null,
  source: "manual",
  customer_id: "c1",
  customer_snapshot: { display_name: "Kunde AS", customer_number: "4711" },
  delivery_date: "2026-01-02",
  delivery_time: null,
  delivery_tour_id: null,
  total_incl_vat: 0,
  status_changed_at: "2026-01-01T09:00:00Z",
  ordered_at: "2026-01-01T09:00:00Z",
  created_at: "2026-01-01T09:00:00Z",
  rule_flags: null,
  rule_override_reason: null,
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

describe("ordersToDeskRows", () => {
  it("viser kundenavn og ordrenummer, og advarer når turen mangler", () => {
    const [row] = ordersToDeskRows([o({ id: "o9", order_number: "10099" })]);
    expect(row.to).toBe("/ordre/ordrer/o9");
    expect(row.primary).toBe("Kunde AS");
    expect(row.secondary).toBe("10099 · #4711");
    expect(row.tone).toBe("warning");
  });

  it("faller tilbake til ordrenummer uten kundesnapshot", () => {
    const [row] = ordersToDeskRows([
      o({ order_number: "10100", customer_snapshot: null, delivery_tour_id: "tur-1" }),
    ]);
    expect(row.primary).toBe("Ordre 10100");
    expect(row.tone).toBe("default");
  });
});

describe("recurringToDeskRows", () => {
  it("lenker til fastordre for valgt dato", () => {
    const [row] = recurringToDeskRows(
      [
        {
          schedule_id: "s1",
          customer_id: "c1",
          customer_display_name: "Fast Kunde",
          customer_number: "900",
          tour_label: "Tur 3",
        },
      ],
      "2026-02-05",
    );
    expect(row.to).toBe("/ordre/faste-rutiner?date=2026-02-05");
    expect(row.secondary).toBe("#900");
    expect(row.badge).toBe("Tur 3");
  });
});

describe("buildMustHandleGroups", () => {
  const groups = () =>
    buildMustHandleGroups({
      approvalRows: [o({ id: "a1" }), o({ id: "a2" })],
      approvalTotal: 7,
      tickets: [t({ id: "t1", status: "new" }), t({ id: "t2", assigned_to: null })],
    });

  it("holder godkjenninger og e-post i hver sin gruppe med egen destinasjon", () => {
    const [approvals, tickets] = groups();
    expect(approvals.to).toBe("/ordre/ordrer?status=awaiting_confirmation");
    expect(approvals.toLabel).toBe("Godkjenningskø");
    expect(approvals.rows.every((r) => r.id.startsWith("order-"))).toBe(true);
    expect(tickets.to).toBe("/ordre/ticket");
    expect(tickets.toLabel).toBe("Åpne innboks");
    expect(tickets.rows.every((r) => r.id.startsWith("ticket-"))).toBe(true);
  });

  it("bruker serverens totalantall for godkjenninger, ikke antall synlige rader", () => {
    const [approvals] = groups();
    expect(approvals.rows).toHaveLength(2);
    expect(approvals.total).toBe(7);
  });

  it("begrenser antall synlige rader per gruppe", () => {
    const many = Array.from({ length: 12 }, (_, i) => o({ id: `a${i}` }));
    const [approvals] = buildMustHandleGroups({
      approvalRows: many,
      approvalTotal: many.length,
      tickets: [],
    });
    expect(approvals.rows).toHaveLength(MUST_HANDLE_ROWS_PER_GROUP);
    expect(approvals.total).toBe(12);
  });

  it("aldri lar totalen bli lavere enn radene som faktisk vises", () => {
    const [approvals] = buildMustHandleGroups({
      approvalRows: [o({ id: "a1" }), o({ id: "a2" })],
      approvalTotal: 0,
      tickets: [],
    });
    expect(approvals.total).toBe(2);
  });

  it("summerer begge gruppene i totalOfGroups", () => {
    expect(totalOfGroups(groups())).toBe(9);
  });
});

describe("deskHeaderFormat", () => {
  it("formaterer norsk dato med stor forbokstav", () => {
    const text = formatNorwegianToday(new Date("2026-09-03T08:00:00Z"));
    expect(text.startsWith("T")).toBe(true);
    expect(text).toContain("september");
    expect(text).toContain("2026");
  });

  it("viser klokkeslett i Oslo-tid når data finnes", () => {
    expect(formatLastUpdated(new Date("2026-09-03T07:14:00Z").getTime())).toBe(
      "Sist oppdatert kl. 09:14",
    );
  });

  it("sier tydelig fra før første henting", () => {
    expect(formatLastUpdated(0)).toBe("Ikke oppdatert ennå");
  });
});
