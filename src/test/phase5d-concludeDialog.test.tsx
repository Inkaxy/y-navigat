// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NegotiationItemRow, NegotiationRecipientRow, NegotiationResponseRow } from "@/ravarer/hooks/useNegotiations";

const invoke = vi.fn();
const setPrimary = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/ravarer/lib/supplierLinkRpc", () => ({ setPrimarySupplier: (...a: unknown[]) => setPrimary(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ConcludeDialog } from "@/ravarer/pages/forhandlinger/detail/ConcludeDialog";

const items = [
  { id: "i1", raw_material_id: "rm1" },
  { id: "i2", raw_material_id: "rm2" },
] as NegotiationItemRow[];
const recipients = [{ id: "r1", supplier_id: "s1" }] as NegotiationRecipientRow[];
const responses = [
  { id: "x1", recipient_id: "r1", negotiation_item_id: "i1", status: "submitted", offered_price: 10, offered_package_size: null, offered_package_unit: null },
  { id: "x2", recipient_id: "r1", negotiation_item_id: "i2", status: "submitted", offered_price: 20, offered_package_size: null, offered_package_unit: null },
] as NegotiationResponseRow[];

function setup() {
  const onRefresh = vi.fn();
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConcludeDialog
        open onOpenChange={onOpenChange} items={items} responses={responses} recipients={recipients}
        bestByItem={new Map([["i1", "r1"], ["i2", "r1"]])} rmName={(id) => (id === "rm1" ? "Mel" : "Sukker")}
        rmBaseUnit={() => "kg"} supName={() => "Lev 1"} negotiationId="n1" onRefresh={onRefresh}
      />
    </QueryClientProvider>,
  );
  return { onRefresh, onOpenChange };
}

beforeEach(() => { invoke.mockReset(); setPrimary.mockReset(); });

describe("ConcludeDialog", () => {
  it("gjentar bare gjenstående primærsteg, aldri utfallsmotoren", async () => {
    invoke.mockResolvedValue({ data: { success: true, applied: 2 }, error: null });
    setPrimary.mockImplementation(async (rm: string) => { if (rm === "rm2") throw new Error("x"); });
    setup();
    for (const cb of screen.getAllByRole("checkbox", { name: /Sett som primær/ })) fireEvent.click(cb);
    fireEvent.click(screen.getByRole("button", { name: /^Avslutt/ }));
    expect(await screen.findByText(/primærleverandør ble ikke satt/)).toBeInTheDocument();
    expect(screen.getByText(/Sukker/)).toBeInTheDocument();
    setPrimary.mockReset().mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /Sett gjenstående primærleverandør/ }));
    await waitFor(() => expect(setPrimary).toHaveBeenCalledTimes(1));
    expect(setPrimary).toHaveBeenCalledWith("rm2", "s1");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("ukjent utfall låser skjemaet uten automatisk nytt kall; dobbeltklikk gir ett kall", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    setup();
    const btn = screen.getByRole("button", { name: /^Avslutt/ });
    fireEvent.click(btn); fireEvent.click(btn);
    expect(await screen.findByText(/ingen kvittering/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Avslutt/ })).toBeDisabled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(setPrimary).not.toHaveBeenCalled();
  });
});
