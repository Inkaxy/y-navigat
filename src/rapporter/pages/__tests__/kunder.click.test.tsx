import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/rapporter/hooks/useSalesAggregate", async () => {
  const actual = await vi.importActual<any>("@/rapporter/hooks/useSalesAggregate");
  const custRows = [
    { bucket: null, dim_id: "c1", dim_code: "100", dim_label: "Teie", amount: 88658.39, quantity: 3764, line_count: 539, order_count: 10 },
  ];
  const prodRows = [
    { bucket: null, dim_id: "p1", dim_code: "1", dim_label: "Loff", amount: 88658.39, quantity: 3764, line_count: 539, order_count: 10 },
  ];
  return {
    ...actual,
    useCustomerProfileOptions: () => ({ data: [] }),
    useStatisticGroupOptions: () => ({ data: [] }),
    useSalesAggregate: (_r: any, dim: string) => ({
      data: dim === "customer" ? custRows : prodRows,
      isLoading: false,
    }),
  };
});

import Kunder from "../Kunder";

describe("Kunder", () => {
  it("åpner handlekurv ved klikk på kunderad", async () => {
    render(<Kunder />);
    fireEvent.click(screen.getByText("Teie"));
    await waitFor(() => expect(screen.getByText(/Handlekurv — Teie/)).toBeTruthy());
    expect(screen.getByText("Loff")).toBeTruthy();
  });
});
