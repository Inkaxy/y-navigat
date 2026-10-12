// @vitest-environment jsdom
/** Faktisk ForhandlingWizard: kladd overskrives ikke av bakgrunnslesing, og Neste er single-flight. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const st = vi.hoisted(() => ({ existing: null as null | Record<string, unknown>, update: vi.fn(), create: vi.fn() }));
vi.mock("@/ravarer/hooks/useNegotiations", () => ({
  useCreateNegotiation: () => ({ mutateAsync: st.create, isPending: false }),
  useUpdateNegotiation: () => ({ mutateAsync: st.update, isPending: false }),
  useNegotiation: () => ({ data: st.existing }),
  useNegotiationItems: () => ({ data: [] }),
  useNegotiationRecipients: () => ({ data: [] }),
  useUpsertNegotiationItems: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpsertNegotiationRecipients: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateRfqCredentials: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite: true, canApprove: false }) }));
vi.mock("@/ravarer/hooks/usePurchaseStats", () => ({ useAllRawMaterialPurchaseStats: () => ({ data: new Map() }) }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({ useRawMaterials: () => ({ data: [] }) }));
vi.mock("@/ravarer/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [] }) }));
vi.mock("@/ravarer/ui/ModulePage", () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ForhandlingWizard from "@/ravarer/pages/forhandlinger/ForhandlingWizard";

const base = { id: "N1", title: "Original", purpose: null, contract_start: null, contract_end: null, baseline_period_start: null, baseline_period_end: null, response_deadline: null, status: "draft", rfq_issued_at: null };
function mount() {
  return render(<MemoryRouter initialEntries={["/x/N1"]}><Routes><Route path="/x/:id" element={<ForhandlingWizard />} /></Routes></MemoryRouter>);
}
beforeEach(() => { st.existing = { ...base }; st.update.mockReset(); st.create.mockReset(); });

describe("ForhandlingWizard", () => {
  it("bakgrunnsoppdatering av samme forhandling overskriver ikke brukerens tittel", () => {
    const { rerender } = mount();
    const input = screen.getByLabelText("Tittel *") as HTMLInputElement;
    expect(input.value).toBe("Original");
    fireEvent.change(input, { target: { value: "Brukerens kladd" } });
    st.existing = { ...base, title: "Bakgrunnsverdi" };
    rerender(<MemoryRouter initialEntries={["/x/N1"]}><Routes><Route path="/x/:id" element={<ForhandlingWizard />} /></Routes></MemoryRouter>);
    expect((screen.getByLabelText("Tittel *") as HTMLInputElement).value).toBe("Brukerens kladd");
  });

  it("dobbeltklikk på Neste gir én lagring og ett steg", async () => {
    let release = () => undefined as void;
    st.update.mockReturnValue(new Promise<void>((r) => { release = r; }));
    mount();
    const next = screen.getByRole("button", { name: /Neste/ });
    fireEvent.click(next); fireEvent.click(next);
    await act(async () => { release(); });
    expect(st.update).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText("Tittel *")).toBeNull());
    // Steg 2 (ikke 3): bare ett steg fram.
    expect(screen.getAllByText(/Råvarer/).length).toBeGreaterThan(0);
    expect(st.update).toHaveBeenCalledTimes(1);
  });
});
