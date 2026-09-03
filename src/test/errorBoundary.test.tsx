// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/errors/ErrorBoundary";
import { createErrorId } from "@/lib/errorLog";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Testfeil i modulen");
  return <p>Innhold er tilbake</p>;
}

/** Lar testen slå av feilen før «Prøv igjen» trykkes. */
function Harness() {
  const [shouldThrow, setShouldThrow] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShouldThrow(false)}>
        Fiks
      </button>
      <ErrorBoundary variant="module" scope="test">
        <Boom shouldThrow={shouldThrow} />
      </ErrorBoundary>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("viser norsk fallback og logger strukturert med feil-ID", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary variant="module" scope="test">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Denne delen kunne ikke vises")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Prøv igjen/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gå til forsiden/i })).toBeTruthy();
    expect(screen.getByText(/^NBH-/)).toBeTruthy();

    const logged = errorSpy.mock.calls.find((call) => call[0] === "[nbhub:error]");
    expect(logged).toBeTruthy();
    const payload = logged?.[1] as { errorId: string; scope: string; message: string };
    expect(payload.scope).toBe("boundary:module:test");
    expect(payload.message).toBe("Testfeil i modulen");
    expect(payload.errorId.startsWith("NBH-")).toBe(true);
  });

  it("viser fullskjerm-tekst for app-varianten", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary variant="app">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Noe gikk galt i NBHub")).toBeTruthy();
  });

  it("gjenoppretter innholdet når brukeren trykker «Prøv igjen»", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<Harness />);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fiks" }));
    fireEvent.click(screen.getByRole("button", { name: /Prøv igjen/i }));

    expect(screen.getByText("Innhold er tilbake")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rendrer barna når ingenting feiler", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Innhold er tilbake")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("createErrorId", () => {
  it("lager en kort, lesbar ID med NBH-prefiks", () => {
    const id = createErrorId(1767225600000, 0.5);
    expect(id).toMatch(/^NBH-[0-9A-Z]{6}-[0-9A-F]{4}$/);
  });
});
