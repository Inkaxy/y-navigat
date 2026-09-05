import { describe, it, expect } from "vitest";
import { getStatusActions, canCancel, canDelete } from "@/ordre/lib/statusTransitions";
import type { OrderStatus } from "@/ordre/lib/orderStatus";

describe("getStatusActions", () => {
  it("gir godkjenn/avvis når ordren venter på bekreftelse", () => {
    const actions = getStatusActions("awaiting_confirmation");
    expect(actions.map((a) => a.to)).toEqual(["confirmed", "cancelled"]);
    expect(actions[0].label).toBe("Godkjenn");
    expect(actions[1].requireComment).toBe(true);
  });

  it("bruker retur-tekster for returordre", () => {
    const actions = getStatusActions("awaiting_confirmation", true);
    expect(actions[0].label).toBe("Godkjenn retur");
    expect(actions[1].commentLabel).toBe("Hvorfor avvises returen?");
  });

  it("gir ingen handlinger uten godkjenningsgrunnlag", () => {
    expect(getStatusActions("awaiting_confirmation", false, false)).toEqual([]);
  });

  it("gir kun «Avbryt ordre» for bekreftet ordre", () => {
    const actions = getStatusActions("confirmed");
    expect(actions).toHaveLength(1);
    expect(actions[0].to).toBe("cancelled");
    expect(actions[0].variant).toBe("destructive");
  });

  it("gir ingen manuelle overganger for øvrige statuser", () => {
    const rest: OrderStatus[] = ["delivered", "invoiced", "cancelled"];
    for (const s of rest) {
      expect(getStatusActions(s)).toEqual([]);
    }
  });
});

describe("canCancel", () => {
  it("tillater avbryt kun for bekreftet og venter på bekreftelse", () => {
    expect(canCancel("confirmed")).toBe(true);
    expect(canCancel("awaiting_confirmation")).toBe(true);
    expect(canCancel("delivered")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});

describe("canDelete", () => {
  it("admin kan alltid slette", () => {
    expect(canDelete("delivered", false, true)).toBe(true);
  });

  it("skrivetilgang kan slette ordre som venter på bekreftelse", () => {
    expect(canDelete("awaiting_confirmation", true, false)).toBe(true);
    expect(canDelete("awaiting_confirmation", false, false)).toBe(false);
    expect(canDelete("confirmed", true, false)).toBe(false);
  });
});
