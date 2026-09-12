import { describe, it, expect } from "vitest";

import {
  PricingRequestTracker,
  pricesResolved,
} from "@/ordre/lib/pricingRequestState";

describe("PricingRequestTracker", () => {
  it("markerer prisene som uavklart mens et oppslag pågår", () => {
    const t = new PricingRequestTracker();
    const gen = t.start();
    expect(t.status()).toEqual({ pending: true, failed: false });
    expect(pricesResolved(t.status())).toBe(false);
    expect(t.succeed(gen)).toBe(true);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("to overlappende oppslag: gammelt svar SIST åpner ikke lagring", () => {
    const t = new PricingRequestTracker();
    const first = t.start();
    const second = t.start();
    // Nyeste svarer først …
    expect(t.succeed(second)).toBe(true);
    expect(pricesResolved(t.status())).toBe(true);
    // … deretter kommer det utdaterte svaret og skal ignoreres.
    expect(t.succeed(first)).toBe(false);
    expect(t.fail(first)).toBe(false);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("gammelt svar SIST skal heller ikke avslutte et nyere, pågående oppslag", () => {
    const t = new PricingRequestTracker();
    const first = t.start();
    const second = t.start();
    expect(t.succeed(first)).toBe(false);
    // Nyeste pågår fortsatt → lagring fortsatt sperret.
    expect(t.status()).toEqual({ pending: true, failed: false });
    expect(pricesResolved(t.status())).toBe(false);
    expect(t.succeed(second)).toBe(true);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("feilet oppslag sperrer lagring til nytt forsøk lykkes", () => {
    const t = new PricingRequestTracker();
    const gen = t.start();
    expect(t.fail(gen)).toBe(true);
    expect(t.status()).toEqual({ pending: false, failed: true });
    expect(pricesResolved(t.status())).toBe(false);
    const retry = t.start();
    expect(t.status().failed).toBe(false);
    t.succeed(retry);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("utdatert feil sperrer ikke en nyere, vellykket dato", () => {
    const t = new PricingRequestTracker();
    const first = t.start();
    const second = t.start();
    t.succeed(second);
    expect(t.fail(first)).toBe(false);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("tilbake til originaldato under pågående oppslag forkaster oppslaget", () => {
    const t = new PricingRequestTracker();
    const gen = t.start();
    t.invalidate();
    expect(t.status()).toEqual({ pending: false, failed: false });
    expect(pricesResolved(t.status())).toBe(true);
    // Svaret fra mellomdatoen kommer etterpå og skal ikke brukes.
    expect(t.succeed(gen)).toBe(false);
    expect(t.fail(gen)).toBe(false);
    expect(pricesResolved(t.status())).toBe(true);
  });

  it("invalidate rydder også bort en tidligere feil", () => {
    const t = new PricingRequestTracker();
    const gen = t.start();
    t.fail(gen);
    t.invalidate();
    expect(pricesResolved(t.status())).toBe(true);
  });
});
