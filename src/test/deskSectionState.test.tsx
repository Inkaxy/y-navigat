// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeskSectionState } from "@/ordre/components/dashboard/DeskSectionState";

/**
 * `DeskSectionState` er feil-/laste-/tomtilstanden på ordrekontorets arbeidsbord.
 *
 * Reglene som testes her er de som tidligere ble brutt: loggingen skjedde under
 * render (ny feil-ID for hver render, støy i konsollen), og feilobjektet ble
 * ikke sendt videre. En feil skal logges nøyaktig én gang per feilforekomst, og
 * feil-IDen brukeren leser opp til support skal stå stille så lenge samme feil
 * vises.
 */
describe("DeskSectionState", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const idOf = (): string => {
    const match = screen.getByRole("alert").textContent?.match(/NBH-[A-Z0-9-]+/);
    if (!match) throw new Error("fant ingen feil-ID i feilflaten");
    return match[0];
  };

  const loggedCalls = (scope: string) =>
    (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { scope?: string }).scope === scope,
      ),
    );

  it("beholder samme feil-ID så lenge samme feil vises", () => {
    const error = new Error("boom");
    const { rerender } = render(
      <DeskSectionState isError error={error} scope="ordre:test:stabil">
        <p>Innhold</p>
      </DeskSectionState>,
    );
    const first = idOf();

    rerender(
      <DeskSectionState isError error={error} scope="ordre:test:stabil">
        <p>Innhold</p>
      </DeskSectionState>,
    );
    rerender(
      <DeskSectionState isError error={error} scope="ordre:test:stabil" skeletonRows={7}>
        <p>Innhold</p>
      </DeskSectionState>,
    );

    expect(idOf()).toBe(first);
    expect(loggedCalls("ordre:test:stabil")).toHaveLength(1);
  });

  it("logger på nytt med ny feil-ID når feilen faktisk endrer seg", () => {
    const { rerender } = render(
      <DeskSectionState isError error={new Error("første")} scope="ordre:test:ny">
        <p>Innhold</p>
      </DeskSectionState>,
    );
    const first = idOf();

    rerender(
      <DeskSectionState isError error={new Error("andre")} scope="ordre:test:ny">
        <p>Innhold</p>
      </DeskSectionState>,
    );

    expect(idOf()).not.toBe(first);
    expect(loggedCalls("ordre:test:ny")).toHaveLength(2);
  });

  it("logger det faktiske feilobjektet, ikke bare en tekst", () => {
    const error = new Error("teknisk detalj");
    render(
      <DeskSectionState isError error={error} scope="ordre:test:objekt">
        <p>Innhold</p>
      </DeskSectionState>,
    );

    const call = loggedCalls("ordre:test:objekt")[0] as [string, { error: unknown; message: string }];
    expect(call[1].error).toBe(error);
    expect(call[1].message).toBe("teknisk detalj");
    // Rå backend-tekst skal aldri nå brukeren.
    expect(screen.getByRole("alert")).not.toHaveTextContent("teknisk detalj");
  });

  it("logger ikke når seksjonen laster eller er tom", () => {
    const { rerender } = render(
      <DeskSectionState isLoading scope="ordre:test:stille">
        <p>Innhold</p>
      </DeskSectionState>,
    );
    rerender(
      <DeskSectionState isEmpty emptyText="Ingenting å vise." scope="ordre:test:stille">
        <p>Innhold</p>
      </DeskSectionState>,
    );

    expect(screen.getByText("Ingenting å vise.")).toBeInTheDocument();
    expect(loggedCalls("ordre:test:stille")).toHaveLength(0);
  });
});
