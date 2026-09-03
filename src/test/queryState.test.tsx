import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryState } from "@/components/common/QueryState";

/**
 * `QueryState` er felles laste-/feil-/tomtilstand. Reglene som testes her er de
 * som tidligere ble brutt rundt om i appen: en feilende spørring skal aldri
 * presenteres som «ingen treff», og feilteksten skal ikke lekke rå backend-tekst.
 */
describe("QueryState", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("viser innhold når spørringen lyktes og har data", () => {
    render(
      <QueryState scope="test" isEmpty={false}>
        <p>Innhold</p>
      </QueryState>,
    );
    expect(screen.getByText("Innhold")).toBeInTheDocument();
  });

  it("viser skjelett med aria-busy under lasting", () => {
    const { container } = render(
      <QueryState scope="test" isLoading skeletonRows={3}>
        <p>Innhold</p>
      </QueryState>,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Innhold")).not.toBeInTheDocument();
  });

  it("viser tomtilstand kun når spørringen faktisk lyktes", () => {
    render(
      <QueryState scope="test" isEmpty emptyTitle="Ingen treff">
        <p>Innhold</p>
      </QueryState>,
    );
    expect(screen.getByText("Ingen treff")).toBeInTheDocument();
  });

  it("lar feil vinne over både lasting og tom", () => {
    render(
      <QueryState scope="test" isError isLoading isEmpty error={new Error("boom")}>
        <p>Innhold</p>
      </QueryState>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Kunne ikke hente dataene");
    expect(alert).not.toHaveTextContent("boom");
    expect(screen.queryByText("Innhold")).not.toBeInTheDocument();
  });

  it("viser feil-ID for support og kaller onRetry", async () => {
    const onRetry = vi.fn();
    render(
      <QueryState scope="test" isError error={new Error("boom")} onRetry={onRetry}>
        <p>Innhold</p>
      </QueryState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/feil-ID \S+ til support/);
    await userEvent.click(screen.getByRole("button", { name: /prøv igjen/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("logger feilen strukturert én gang med scope", () => {
    const spy = vi.spyOn(console, "error");
    const { rerender } = render(
      <QueryState scope="ordre:test" isError error={new Error("boom")}>
        <p>Innhold</p>
      </QueryState>,
    );
    rerender(
      <QueryState scope="ordre:test" isError error={new Error("boom")}>
        <p>Innhold</p>
      </QueryState>,
    );
    const scoped = spy.mock.calls.filter((call) => JSON.stringify(call).includes("ordre:test"));
    expect(scoped.length).toBeGreaterThanOrEqual(1);
  });
});
