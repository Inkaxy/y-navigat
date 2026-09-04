// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  countQueues,
  isArchiveQueue,
  matchesQueue,
  parseQueueParam,
  type QueueTicket,
} from "@/ordre/lib/ticketQueues";
import { BULK_LABEL } from "@/ordre/lib/ticketBulk";
import { nextActionLabel } from "@/ordre/components/tickets/TicketListRow";
import { buildFieldSuggestions } from "@/ordre/components/tickets/AiFieldSuggestions";
import AiReplyDraftCard from "@/ordre/components/tickets/AiReplyDraftCard";

const base: QueueTicket = {
  id: "1",
  status: "new",
  priority: "normal",
  assigned_to: null,
};

describe("ticket-køer", () => {
  it("Mine viser bare åpne saker jeg eier", () => {
    expect(matchesQueue({ ...base, assigned_to: "u1" }, "mine", "u1")).toBe(true);
    expect(matchesQueue({ ...base, assigned_to: "u2" }, "mine", "u1")).toBe(false);
    expect(
      matchesQueue({ ...base, assigned_to: "u1", status: "closed" }, "mine", "u1"),
    ).toBe(false);
  });

  it("Ufordelte krever at ingen eier saken", () => {
    expect(matchesQueue(base, "unassigned", "u1")).toBe(true);
    expect(matchesQueue({ ...base, assigned_to: "u1" }, "unassigned", "u1")).toBe(false);
  });

  it("Må tas nå fanger over frist og haster, men ikke ventende saker", () => {
    expect(matchesQueue({ ...base, overdue: true }, "now", "u1")).toBe(true);
    expect(matchesQueue({ ...base, priority: "urgent" }, "now", "u1")).toBe(true);
    expect(matchesQueue({ ...base, overdue: true, awaitingCustomer: true }, "now", "u1")).toBe(
      false,
    );
  });

  it("Venter fanger kunde-, intern- og ekstern venting", () => {
    expect(matchesQueue({ ...base, awaitingCustomer: true }, "waiting", "u1")).toBe(true);
    expect(matchesQueue({ ...base, awaiting_internal: true }, "waiting", "u1")).toBe(true);
    expect(matchesQueue(base, "waiting", "u1")).toBe(false);
  });

  it("teller alle køer i én runde", () => {
    const rows: QueueTicket[] = [
      { ...base, id: "a", assigned_to: "u1" },
      { ...base, id: "b" },
      { ...base, id: "c", overdue: true },
    ];
    const counts = countQueues(rows, "u1", ["mine", "unassigned", "now", "all_open"]);
    expect(counts).toMatchObject({ mine: 1, unassigned: 2, now: 1, all_open: 3 });
  });

  it("leser kø fra URL med bakoverkompatible aliaser", () => {
    const opts = { intents: ["new_order"], teams: ["ordrekontor"] };
    expect(parseQueueParam(null, opts)).toBe("mine");
    expect(parseQueueParam("all", opts)).toBe("all_open");
    expect(parseQueueParam("intent:new_order", opts)).toBe("intent:new_order");
    expect(parseQueueParam("tull", opts)).toBe("mine");
  });

  it("arkivkøer sorteres på aktivitet", () => {
    expect(isArchiveQueue("closed")).toBe(true);
    expect(isArchiveQueue("mine")).toBe(false);
  });
});

describe("neste handling i listen", () => {
  const row = {
    id: "1",
    subject: "Kake",
    body_preview: null,
    sender_name: null,
    sender_email: "a@b.no",
    received_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "new" as const,
    priority: "normal" as const,
    assigned_to: null,
    has_attachments: false,
    related_order_id: null,
    intent: null,
    overdue: false,
    countdown: null,
    deadline: null,
    awaitingCustomer: false,
  };

  it("ber om at saken tas når ingen eier den", () => {
    expect(nextActionLabel(row)).toBe("Ta saken");
  });

  it("viser venting når kunden er neste", () => {
    expect(nextActionLabel({ ...row, assigned_to: "u1", awaitingCustomer: true })).toBe(
      "Venter på kunde",
    );
  });
});

describe("AI-forslag", () => {
  it("gir feltvise forslag med sikkerhetsnivå og belegg", () => {
    const suggestions = buildFieldSuggestions({
      request_type: "change",
      order_fields: { delivery_date: "2026-05-01" },
      field_confidence: { delivery_date: 0.92 },
      reasoning_per_field: { delivery_date: "flyttes til 1. mai" },
    } as never);
    const dato = suggestions.find((s) => s.field === "delivery_date");
    expect(dato?.level).toBe("high");
    expect(dato?.evidence).toContain("1. mai");
  });

  it("krever bekreftelse før et eksisterende utkast overskrives", async () => {
    const onUse = vi.fn();
    render(
      <AiReplyDraftCard
        draft="Hei, vi har flyttet datoen."
        hasExistingDraft
        onUse={onUse}
        onInsert={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /bruk forslag/i }));
    expect(onUse).not.toHaveBeenCalled();
    await screen.findByText(/erstatte det du har skrevet/i);
    fireEvent.click(screen.getByRole("button", { name: /erstatt/i }));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
  });

  it("bruker forslaget direkte når composer er tom", () => {
    const onUse = vi.fn();
    render(
      <AiReplyDraftCard
        draft="Hei"
        hasExistingDraft={false}
        onUse={onUse}
        onInsert={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /bruk forslag/i }));
    expect(onUse).toHaveBeenCalledTimes(1);
  });
});

describe("bulkhandlinger", () => {
  it("har norske etiketter", () => {
    expect(BULK_LABEL.assign_me).toMatch(/ta/i);
    expect(BULK_LABEL.resolve).toMatch(/ferdig/i);
  });
});
