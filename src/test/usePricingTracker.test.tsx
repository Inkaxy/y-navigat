/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePricingTracker } from "@/ordre/hooks/usePricingTracker";
import { pricesResolved } from "@/ordre/lib/pricingRequestState";

describe("prisoppslag på tvers av ordrer i samme skjema", () => {
  it("forkaster et utestående svar når skjemaet lukkes og åpnes på en annen ordre", () => {
    const { result, rerender } = renderHook(
      (p: { open: boolean; orderId: string | null; customerId: string }) => usePricingTracker(p),
      { initialProps: { open: true, orderId: "ordre-A", customerId: "kunde-1" } },
    );

    // Oppslag starter på ordre A, men svaret er fortsatt i luften.
    let generation = 0;
    act(() => {
      generation = result.current.tracker.start();
      result.current.setStatus(result.current.tracker.status());
    });
    expect(result.current.status.pending).toBe(true);

    // Skjemaet lukkes og åpnes på ordre B.
    rerender({ open: false, orderId: "ordre-A", customerId: "kunde-1" });
    rerender({ open: true, orderId: "ordre-B", customerId: "kunde-1" });

    // Det gamle svaret kommer nå — det skal ikke brukes i ordre B.
    expect(result.current.tracker.succeed(generation)).toBe(false);
    expect(result.current.tracker.fail(generation)).toBe(false);
    expect(result.current.status).toEqual({ pending: false, failed: false });
    expect(pricesResolved(result.current.status)).toBe(true);
  });

  it("forkaster også et utestående svar når kunden byttes", () => {
    const { result, rerender } = renderHook(
      (p: { open: boolean; orderId: string | null; customerId: string }) => usePricingTracker(p),
      { initialProps: { open: true, orderId: null, customerId: "kunde-1" } },
    );
    let generation = 0;
    act(() => {
      generation = result.current.tracker.start();
      result.current.setStatus(result.current.tracker.status());
    });
    rerender({ open: true, orderId: null, customerId: "kunde-2" });
    expect(result.current.tracker.succeed(generation)).toBe(false);
    expect(result.current.status.pending).toBe(false);
  });

  it("rører ikke et pågående oppslag når ingenting byttes", () => {
    const { result, rerender } = renderHook(
      (p: { open: boolean; orderId: string | null; customerId: string }) => usePricingTracker(p),
      { initialProps: { open: true, orderId: "ordre-A", customerId: "kunde-1" } },
    );
    let generation = 0;
    act(() => {
      generation = result.current.tracker.start();
      result.current.setStatus(result.current.tracker.status());
    });
    rerender({ open: true, orderId: "ordre-A", customerId: "kunde-1" });
    expect(result.current.tracker.succeed(generation)).toBe(true);
  });
});
