// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";


vi.mock("@/rapporter/hooks/useSalesAggregate", async () => {
  const actual = await vi.importActual<any>("@/rapporter/hooks/useSalesAggregate");
  const custRows = [
    { bucket: null, dim_id: "c1", dim_code: "100", dim_label: "Teie", amount: 88658.39, quantity: 3764, line_count: 531, order_count: 10 },
    { bucket: null, dim_id: "c2", dim_code: "101", dim_label: "Test", amount: 0, quantity: 0, line_count: 8, order_count: 2 },
  ];
  const prodRows = [
    { bucket: null, dim_id: "p1", dim_code: "1", dim_label: "Loff", amount: 50000, quantity: 2000, line_count: 300, order_count: 8 },
    { bucket: null, dim_id: "p2", dim_code: "2", dim_label: "Rundstykke", amount: 38658.39, quantity: 1764, line_count: 231, order_count: 7 },
  ];
  return {
    ...actual,
    useCustomerProfileOptions: () => ({ data: [] }),
    useStatisticGroupOptions: () => ({ data: [] }),
    useSalesAggregate: (_r: any, dim: string, _g: string, filters: any, enabled = true) => ({
      data: !enabled ? undefined : dim === "customer" ? custRows : filters?.customerId === "c1" ? prodRows : [],
      isLoading: false,
      error: null,
    }),
  };
});

import Kunder from "../Kunder";

const renderPage = () => {
  // ReportFilterBar → SaveReportDialog bruker useQueryClient, så siden må
  // rendres inne i en QueryClientProvider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Kunder />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};


describe("Kunder", () => {
  it("åpner handlekurven med korrekt sum ved klikk på kunderad", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Teie"));
    await waitFor(() => expect(screen.getByText(/Handlekurv — Teie/)).toBeTruthy());
    expect(screen.getByText("Loff")).toBeTruthy();
    // Sum av varelinjene = 88 658,39
    expect(screen.getAllByText(/88\s?658,39/).length).toBeGreaterThanOrEqual(2);
  });

  it("åpner handlekurven ved klikk på chevron-knappen", async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText("Vis handlekurv for Teie"));
    await waitFor(() => expect(screen.getByText(/Handlekurv — Teie/)).toBeTruthy());
  });
});
