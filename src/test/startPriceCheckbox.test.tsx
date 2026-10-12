// @vitest-environment jsdom
/** Startpriskandidat: hele 44px-feltet rundt avkrysningen aktiverer den; ingen bekreftelse skjer ved avhuking. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/fakturaer/lib/startPrice", () => ({
  START_PRICE_QUERY_KEYS: { candidates: (a: unknown, b: unknown) => ["sp", a, b] },
  confirmReasonLabel: () => "",
  confirmStartPrice: confirm,
  fetchStartPriceCandidates: async () => [{ invoice_line_id: "L1", raw_material_name: "Hvetemel", description: "x", supplier_name: "S", invoice_number: "1", invoice_date: "2026-01-01", price_per_base_unit: 10, currency: "NOK" }],
}));
vi.mock("@/ravarer/lib/invalidate", () => ({ invalidateRavarerCounts: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { StartPriceCandidatesCard } from "@/fakturaer/components/StartPriceCandidatesCard";

describe("StartPriceCandidatesCard", () => {
  it("klikk på 44px-omslaget huker av kandidaten uten å bekrefte", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><StartPriceCandidatesCard legalEntityId="LE" canWrite /></QueryClientProvider>);
    const box = await screen.findByRole("checkbox", { name: "Velg Hvetemel" });
    const wrapper = box.closest("label")!;
    expect(wrapper.className).toMatch(/h-\[44px\]/);
    expect(wrapper.className).toMatch(/w-\[44px\]/);
    fireEvent.click(wrapper);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(confirm).not.toHaveBeenCalled();
  });
});
