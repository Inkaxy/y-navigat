// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { NegotiationRecipientRow } from "@/ravarer/hooks/useNegotiations";

const invoke = vi.fn();
const updateNeg = vi.fn();
const logEvent = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/ravarer/hooks/useNegotiations", () => ({ useUpdateNegotiation: () => ({ mutateAsync: updateNeg }) }));
vi.mock("@/ravarer/hooks/useLiveNegotiation", () => ({ useLogLiveEvent: () => ({ mutateAsync: logEvent }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { EndSessionDialog } from "@/ravarer/pages/forhandlinger/components/EndSessionDialog";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const rec = (id: string, sup: string) => ({ id, supplier_id: sup } as NegotiationRecipientRow);
const recipients = [rec(A, "supA"), rec(B, "supB")];
const cred = (rid: string, sup: string, pw: string) => ({ recipient_id: rid, supplier_id: sup, supplier_name: sup, access_token: `tok-${rid.slice(0, 4)}`, password: pw, contact_email: `${sup}@x.no`, portal_url: `https://x/tilbud/tok-${rid.slice(0, 4)}` });

function deferred<T>() { let r!: (v: T) => void; const p = new Promise<T>((res) => { r = res; }); return { p, r }; }

function setup(over: Partial<React.ComponentProps<typeof EndSessionDialog>> = {}) {
  const props: React.ComponentProps<typeof EndSessionDialog> = {
    open: true, onOpenChange: vi.fn(), negotiationId: "n1", legalEntityId: "e1", title: "T",
    recipients, selectedRecipient: recipients[1], supplierName: (s) => (s === "supA" ? "Leverandør A" : "Leverandør B"),
    summaryLines: (l) => [`Leverandør: ${l}`], processedCount: 1, totalCount: 2, savingsValue: null, ...over,
  };
  const r = render(<EndSessionDialog {...props} />);
  return { ...r, props };
}

beforeEach(() => { invoke.mockReset(); updateNeg.mockReset().mockResolvedValue(undefined); logEvent.mockReset().mockResolvedValue(undefined); });

describe("EndSessionDialog (live-bekreftelse)", () => {
  it("viser B sitt passord når B er valgt, også med omvendt svarrekkefølge", async () => {
    invoke.mockResolvedValue({ data: { success: true, credentials: [cred(B, "supB", "pwB"), cred(A, "supA", "pwA")] }, error: null });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Avslutt og generer lenke/ }));
    const box = await screen.findByTestId("end-credentials");
    expect(box.textContent).toContain("pwB");
    expect(box.textContent).not.toContain("pwA");
    expect(box.textContent).toContain("Leverandør B");
  });

  it("dobbeltklikk gir ett kall; valgbytte under generering beholder frosset B", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invoke.mockReturnValue(d.p);
    const { rerender, props } = setup();
    const btn = screen.getByRole("button", { name: /Avslutt og generer lenke/ });
    fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rerender(<EndSessionDialog {...props} selectedRecipient={recipients[0]} />);
    await act(async () => { d.r({ data: { success: true, credentials: [cred(A, "supA", "pwA"), cred(B, "supB", "pwB")] }, error: null }); });
    const box = await screen.findByTestId("end-credentials");
    expect(box.textContent).toContain("pwB");
  });

  it("manglende eller duplisert mottaker gir ukjent utfall uten passord, og krever eksplisitt bekreftelse", async () => {
    invoke.mockResolvedValue({ data: { success: true, credentials: [cred(A, "supA", "pwA"), cred(A, "supA", "pwA2")] }, error: null });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Avslutt og generer lenke/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ukjent/);
    expect(screen.queryByTestId("end-credentials")).toBeNull();
    const regen = screen.getByRole("button", { name: /Generer ny lenke/ });
    expect(regen).toBeDisabled();
    expect(invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: /nye passord/ }));
    expect(regen).not.toBeDisabled();
  });

  it("nettverksfeil gir ukjent utfall og ingen automatisk nytt kall", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Avslutt og generer lenke/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("sent svar etter bytte av forhandling eller selskap vises ikke", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invoke.mockReturnValue(d.p);
    const { rerender, props } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Avslutt og generer lenke/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    rerender(<EndSessionDialog {...props} legalEntityId="e2" />);
    await act(async () => { d.r({ data: { success: true, credentials: [cred(A, "supA", "pwA"), cred(B, "supB", "pwB")] }, error: null }); });
    expect(screen.queryByTestId("end-credentials")).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("sent svar etter avmontering skriver ingen hendelse", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invoke.mockReturnValue(d.p);
    const { unmount } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Avslutt og generer lenke/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    await act(async () => { d.r({ data: { success: true, credentials: [cred(A, "supA", "pwA"), cred(B, "supB", "pwB")] }, error: null }); });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("uten valgt mottaker kan ikke lenke genereres", () => {
    setup({ selectedRecipient: undefined });
    expect(screen.getByRole("button", { name: /Avslutt og generer lenke/ })).toBeDisabled();
  });
});
