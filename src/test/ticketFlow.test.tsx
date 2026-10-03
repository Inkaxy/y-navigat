// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTerminalTicket, nextActionFor, pruneSelection } from "@/ordre/lib/ticketRowState";
import {
  orderBackTarget,
  orderHref,
  ticketBackTarget,
  ticketHref,
} from "@/ordre/lib/ticketReturn";
import { collectLinkedOrders } from "@/ordre/hooks/useTicketDetailData";
import { parsePriorityParam } from "@/ordre/components/tickets/InboxFilterBar";

const T = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const base = {
  status: "in_progress" as const,
  assigned_to: "u1",
  related_order_id: O,
  intent: "change",
  awaitingCustomer: false,
};

describe("avsluttede vs åpne saker", () => {
  it("løst, lukket og søppel er avsluttet og får nøytral tekst", () => {
    for (const s of ["resolved", "closed", "spam"] as const) {
      expect(isTerminalTicket(s)).toBe(true);
      expect(nextActionFor({ ...base, status: s, awaitingCustomer: true })).not.toMatch(
        /venter|svar|ansvarlig/i,
      );
    }
    expect(isTerminalTicket("new")).toBe(false);
  });

  it("alle venteflagg gir riktig neste steg", () => {
    expect(nextActionFor({ ...base, awaitingCustomer: true })).toBe("Venter på kunde");
    expect(nextActionFor({ ...base, awaiting_internal: true })).toMatch(/intern/);
    expect(nextActionFor({ ...base, awaiting_external: true })).toMatch(/ekstern/);
  });

  it("delt kobling teller som ordre", () => {
    expect(nextActionFor({ ...base, related_order_id: null, linkedOrderCount: 1 })).toBe(
      "Svar kunden",
    );
    expect(nextActionFor({ ...base, related_order_id: null })).toBe("Koble til ordre");
  });
});

describe("returkontekst", () => {
  const inbox = `/ordre/ticket?queue=resolved&q=kake&prio=high&t=${T}&tull=1`;

  it("beholder bare gyldige innboksparametre", () => {
    const href = ticketHref(T, inbox);
    const back = ticketBackTarget(new URL(href, "http://x").searchParams.get("fra"));
    expect(back.kind).toBe("inbox");
    expect(back.href).toBe(`/ordre/ticket?queue=resolved&q=kake&prio=high&t=${T}`);
  });

  it("avviser eksterne og andre interne mål", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/varer/vareliste", "/ordre/ticket/ikke-uuid"]) {
      expect(ticketBackTarget(bad).href).toBe("/ordre/ticket");
      expect(orderBackTarget(bad)).toBeNull();
    }
    expect(ticketBackTarget("/ordre/ticket?prio=tull").href).toBe("/ordre/ticket");
  });

  it("flere rundturer vokser ikke", () => {
    const t1 = ticketHref(T, inbox);
    const o1 = orderHref(O, t1);
    const backFromOrder = orderBackTarget(new URL(o1, "http://x").searchParams.get("fra"))!;
    expect(backFromOrder.href).toBe(t1);
    const t2 = ticketHref(T, o1);
    const o2 = orderHref(O, t2);
    const t3 = ticketHref(T, o2);
    expect(t3.length).toBeLessThanOrEqual(t2.length);
    expect(o2.length).toBeLessThanOrEqual(o1.length + 20);
  });

  it("samtalefanen gir retur til samme ordre og fane", () => {
    const href = ticketHref(T, `/ordre/ordrer/${O}?tab=samtaler`);
    const back = ticketBackTarget(new URL(href, "http://x").searchParams.get("fra"));
    expect(back).toMatchObject({ kind: "order", href: `/ordre/ordrer/${O}?tab=samtaler` });
  });
});

describe("koblede ordrer", () => {
  const ref = (id: string) => ({ id, order_number: id.slice(0, 4), status: "confirmed", delivery_date: null, customer_id: null });
  it("primær først, deduplisert på ID", () => {
    const out = collectLinkedOrders(O, ref(O), [ref(O), ref(T)]);
    expect(out.map((o) => [o.id, o.primary])).toEqual([[O, true], [T, false]]);
  });
  it("viser delt kobling selv uten primær", () => {
    expect(collectLinkedOrders(null, null, [ref(T)])).toHaveLength(1);
  });
});

describe("filtre og bulkvalg", () => {
  it("validerer prioritet fra URL", () => {
    expect(parsePriorityParam("high")).toBe("high");
    expect(parsePriorityParam("tull")).toBe("all");
    expect(parsePriorityParam(null)).toBe("all");
  });
  it("fjerner skjulte saker fra valget", () => {
    const sel = new Set(["a", "b"]);
    expect([...pruneSelection(sel, ["a"])]).toEqual(["a"]);
    expect(pruneSelection(sel, ["a", "b"])).toBe(sel);
  });
});

const convState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/ordre/hooks/useOrderConversations", () => ({
  useOrderConversations: () => convState.value,
}));
vi.mock("@/ordre/hooks/useUserNames", () => ({ useUserNames: () => ({ data: {} }) }));
vi.mock("@/ordre/components/orders/TimelineCard", () => ({ TimelineCard: () => null }));

async function renderTab() {
  const { OrderConversationsTab } = await import("@/ordre/components/orders/OrderConversationsTab");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OrderConversationsTab orderId={O} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Samtaler-fanen", () => {
  it("feil vinner over tom liste", async () => {
    convState.value = { data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isSuccess: false };
    await renderTab();
    expect(screen.getByText(/kunne ikke hente koblede saker/i)).toBeTruthy();
    expect(screen.queryByText(/ingen saker er koblet/i)).toBeNull();
  });

  it("lasting viser ikke 0", async () => {
    convState.value = { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(), isSuccess: false };
    await renderTab();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText(/ingen saker er koblet/i)).toBeNull();
  });
});
