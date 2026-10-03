import { describe, expect, it } from "vitest";
import {
  inboxOriginTarget,
  orderBackTarget,
  orderHref,
  ticketBackTarget,
  ticketHref,
  TICKET_RETURN_PARAM,
} from "@/ordre/lib/ticketReturn";
import { activeWaitingState } from "@/ordre/lib/ticketRowState";

const T = "4cd88bb4-df03-4316-9e4a-3239c471214e";
const O = "154c871f-b2f7-479f-be06-d9efd355b83c";
const INBOX = `/ordre/ticket?queue=resolved&q=Kake+test&prio=high&t=${T}`;
const params = (href: string) => new URL(href, "https://x.invalid").searchParams;

describe("flere rundreiser innboks → sak → ordre → sak", () => {
  it("bevarer opprinnelig innboks og vokser ikke", () => {
    const ticket1 = ticketHref(T, INBOX);
    const order1 = orderHref(O, ticket1, { tab: "samtaler" });
    const ticket2 = ticketHref(T, order1);
    expect(inboxOriginTarget(params(ticket2), ticketBackTarget(params(ticket2).get(TICKET_RETURN_PARAM)))?.href).toBe(INBOX);
    expect(ticketBackTarget(params(ticket2).get(TICKET_RETURN_PARAM)).kind).toBe("order");

    // Tilbake til ordren beholder innboks-konteksten
    const back = ticketBackTarget(params(ticket2).get(TICKET_RETURN_PARAM));
    const orderNearest = orderBackTarget(params(back.href).get(TICKET_RETURN_PARAM));
    expect(inboxOriginTarget(params(back.href), orderNearest)?.href).toBe(INBOX);

    let href = ticket2;
    const lengths: number[] = [];
    for (let i = 0; i < 5; i++) {
      href = ticketHref(T, orderHref(O, href, { tab: "samtaler" }));
      lengths.push(href.length);
    }
    expect(new Set(lengths).size).toBe(1);
    expect(inboxOriginTarget(params(href), null)?.href).toBe(INBOX);
  });

  it("viser ikke dobbel innboks-retur når nærmeste retur er innboksen", () => {
    const ticket1 = ticketHref(T, INBOX);
    const near = ticketBackTarget(params(ticket1).get(TICKET_RETURN_PARAM));
    expect(near.href).toBe(INBOX);
    expect(inboxOriginTarget(params(ticket1), near)).toBeNull();
  });

  it("avviser ekstern eller feil sti i innboks-parameteret og ugyldige ID-er", () => {
    expect(inboxOriginTarget(new URLSearchParams({ innboks: "//evil.example" }), null)).toBeNull();
    expect(inboxOriginTarget(new URLSearchParams({ innboks: "/ordre/ordrer" }), null)).toBeNull();
    expect(ticketHref("tull", INBOX)).toBe("/ordre/ticket");
    expect(orderHref("tull", INBOX)).toBe("/ordre/ordrer");
  });
});

describe("avsluttet status overstyrer venting", () => {
  it.each(["resolved", "closed", "spam"] as const)("%s viser ingen venting", (status) => {
    expect(activeWaitingState({ status, awaiting_internal: true, awaiting_external: true, awaitingCustomer: true })).toBeNull();
  });
  it("åpne saker viser venting", () => {
    expect(activeWaitingState({ status: "in_progress", awaiting_internal: true })).toBe("internal");
    expect(activeWaitingState({ status: "new", awaiting_external: true })).toBe("external");
    expect(activeWaitingState({ status: "new", awaitingCustomer: true })).toBe("customer");
  });
});
