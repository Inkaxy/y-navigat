// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Ticket } from "@/ordre/hooks/useTickets";

vi.mock("@/ordre/hooks/useTicketDetailData", async (orig) => {
  const actual = await orig<typeof import("@/ordre/hooks/useTicketDetailData")>();
  return {
    ...actual,
    useTicketOrderLinks: () => ({ isLoading: false, isError: false, error: null, data: [], refetch: vi.fn() }),
  };
});
vi.mock("@/ordre/hooks/useUserNames", () => ({ useUserNames: () => ({ data: {} }) }));

import OrderLinkCard from "@/ordre/components/tickets/OrderLinkCard";

describe("OrderLinkCard med hovedordre som ikke finnes", () => {
  it("viser eksplisitt melding med Prøv igjen, ikke opprett-ordre", () => {
    const ticket = {
      id: "4cd88bb4-df03-4316-9e4a-3239c471214e",
      status: "open",
      related_order_id: "11111111-1111-4111-8111-111111111111",
      assigned_to: null,
      assigned_team: null,
    } as unknown as Ticket;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <OrderLinkCard
            ticket={ticket}
            linked={{ order: null, lines: [], customerName: null }}
            linkedState={{ isLoading: false, isError: false, error: null, refetch: vi.fn() }}
            ai={null}
            canWrite
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Den koblede ordren kan ikke vises")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prøv igjen/ })).toBeInTheDocument();
    expect(screen.queryByText(/Ingen ordre koblet/)).toBeNull();
    expect(screen.queryByText(/Opprett ny ordre/)).toBeNull();
  });
});
