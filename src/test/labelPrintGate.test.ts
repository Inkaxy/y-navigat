import { describe, expect, it } from "vitest";
import { evaluateLabelPrintGate } from "@/produksjon/features/etiketter/lib/labelPrintGate";

const ok = {
  hasProfile: true,
  isLoading: false,
  isError: false,
  requiredOrderLineIds: ["ol-1"],
  resolvedOrderLineIds: ["ol-1"],
  criticalMissingCount: 0,
};

describe("portvakt for etikettutskrift", () => {
  it("slipper gjennom når alt er kontrollert", () => {
    const r = evaluateLabelPrintGate(ok);
    expect(r.status).toBe("ok");
    expect(r.canPrint).toBe(true);
  });

  it("sperrer mens deklarasjonskontrollen laster", () => {
    const r = evaluateLabelPrintGate({ ...ok, isLoading: true });
    expect(r.canPrint).toBe(false);
    expect(r.status).toBe("loading");
  });

  it("sperrer med «Prøv igjen» når kontrollen feiler", () => {
    const r = evaluateLabelPrintGate({ ...ok, isError: true });
    expect(r.canPrint).toBe(false);
    expect(r.retryable).toBe(true);
  });

  it("sperrer når svaret mangler en ordrelinje — ingen fabrikkert godkjenning", () => {
    const r = evaluateLabelPrintGate({
      ...ok,
      requiredOrderLineIds: ["ol-1", "ol-2"],
      resolvedOrderLineIds: ["ol-1"],
    });
    expect(r.status).toBe("missing_data");
    expect(r.canPrint).toBe(false);
    expect(r.reason).toContain("én ordrelinje");
  });

  it("sperrer når etiketten ikke kan knyttes til en ordrelinje", () => {
    const r = evaluateLabelPrintGate({
      ...ok,
      requiredOrderLineIds: [],
      resolvedOrderLineIds: [],
      unverifiableCount: 1,
    });
    expect(r.canPrint).toBe(false);
    expect(r.status).toBe("missing_data");
  });

  it("sperrer uten etikettprofil", () => {
    const r = evaluateLabelPrintGate({ ...ok, hasProfile: false });
    expect(r.status).toBe("no_profile");
    expect(r.canPrint).toBe(false);
  });

  it("sperrer ved kritiske mangler", () => {
    const r = evaluateLabelPrintGate({ ...ok, criticalMissingCount: 2 });
    expect(r.status).toBe("blocked");
    expect(r.canPrint).toBe(false);
  });

  it("laster har forrang foran manglende profil", () => {
    expect(evaluateLabelPrintGate({ ...ok, hasProfile: false, isLoading: true }).status).toBe(
      "loading",
    );
  });
});
