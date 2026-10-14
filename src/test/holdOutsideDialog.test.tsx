// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a: Record<string, unknown>) => rpc(n, a) } }));
vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "e1" } }) }));

import { HoldOutsideDialog, type HoldOutsideTarget } from "@/fakturaer/components/HoldOutsideDialog";
import { FocusNotice } from "@/ravarer/pages/priskontroll/faktura/FocusNotice";
import { parseExclusionResult, exclusionErrorText } from "@/fakturaer/lib/invoiceExclusion";
import { MemoryRouter } from "react-router-dom";

const wrap = (n: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider>;
const INV_V = "2026-10-14 05:00:00.123456+00";
const LINE_V = "2026-10-14 05:00:00.654321+00";
const target = (withLine: boolean, scope: "invoice" | "line" = "invoice"): HoldOutsideTarget => ({
  invoice: { id: "b3ec9013", invoice_number: "8050625", updated_at: INV_V, is_credit_note: true },
  line: withLine ? { id: "line-2", line_number: 2, description: "Combisur", updated_at: LINE_V } : null,
  initialScope: scope,
});
const REASON = "Erstatning for ødelagte varer etter produksjonsfeil";

beforeEach(() => { rpc.mockReset(); });

describe("HoldOutsideDialog", () => {
  it("hele dokumentet: riktig id/omfang/versjon/årsak til rm_set_invoice_exclusion, uten linje", async () => {
    rpc.mockResolvedValue({ data: { ok: true, already: false, scope: "invoice", lines: 2, updated_at: INV_V }, error: null });
    const done = vi.fn(); const close = vi.fn();
    render(wrap(<HoldOutsideDialog target={target(false)} canWrite onOpenChange={close} onDone={done} />));
    expect(screen.getByTestId("hold-consequence").textContent).toMatch(/ikke.*avstemt eller godkjent/);
    const btn = screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" });
    expect(btn).toBeDisabled(); // begrunnelse påkrevd
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    fireEvent.click(btn);
    await waitFor(() => expect(done).toHaveBeenCalledWith("invoice"));
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("rm_set_invoice_exclusion");
    expect(args).toMatchObject({ p_invoice_id: "b3ec9013", p_scope: "invoice", p_category: "erstatning_produksjonstap", p_reason: REASON, p_expected_updated_at: INV_V });
    expect(args.p_line_id).toBeUndefined();
    expect(typeof args.p_op_id).toBe("string");
    expect(close).toHaveBeenCalledWith(false);
  });

  it("bare linjen: linje-id og linjens versjon sendes, årsak «Annet»", async () => {
    rpc.mockResolvedValue({ data: { ok: true, already: false, scope: "line", updated_at: LINE_V }, error: null });
    const done = vi.fn();
    render(wrap(<HoldOutsideDialog target={target(true, "line")} canWrite onOpenChange={vi.fn()} onDone={done} />));
    expect(screen.getByRole("radio", { name: "Bare denne linjen" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Annet" }));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: "Ikke råvarepris" } });
    fireEvent.click(screen.getByRole("button", { name: "Hold linjen utenfor" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("line"));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_scope: "line", p_line_id: "line-2", p_expected_updated_at: LINE_V, p_category: "annet" });
  });

  it("fra linje kan omfang byttes til hele dokumentet", async () => {
    rpc.mockResolvedValue({ data: { ok: true, already: false, scope: "invoice", updated_at: INV_V }, error: null });
    render(wrap(<HoldOutsideDialog target={target(true, "line")} canWrite onOpenChange={vi.fn()} />));
    fireEvent.click(screen.getByRole("radio", { name: "Hele dokumentet" }));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_scope: "invoice", p_expected_updated_at: INV_V });
    expect(rpc.mock.calls[0][1].p_line_id).toBeUndefined();
  });

  it("serveravvisning (ført kostpris) vises konkret og dialogen blir stående", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "reversering_kreves", blocked_lines: [{ line_id: "line-2", line_number: 2, blocker: "kostpris_fort" }] }, error: null });
    const close = vi.fn();
    render(wrap(<HoldOutsideDialog target={target(false)} canWrite onOpenChange={close} />));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reversert.*linje 2: kostpris er allerede ført/);
    expect(close).not.toHaveBeenCalled();
  });

  it("transportfeil = ukjent utfall: samme opId sendes uendret på nytt", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    rpc.mockResolvedValueOnce({ data: { ok: true, already: true, scope: "invoice", updated_at: INV_V }, error: null });
    const done = vi.fn();
    render(wrap(<HoldOutsideDialog target={target(false)} canWrite onOpenChange={vi.fn()} onDone={done} />));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/vet ikke om dette ble lagret/);
    expect(screen.getByLabelText("Begrunnelse (påkrevd)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send på nytt" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(rpc.mock.calls[1][1].p_op_id).toBe(rpc.mock.calls[0][1].p_op_id);
    expect(rpc.mock.calls[1][1].p_reason).toBe(REASON);
  });

  it("manglende tilgang (42501) gir tydelig melding", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    render(wrap(<HoldOutsideDialog target={target(false)} canWrite onOpenChange={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ikke skrivetilgang/);
  });

  it("lesetilgang: knappen er sperret og ingen kall sendes", () => {
    render(wrap(<HoldOutsideDialog target={target(false)} canWrite={false} onOpenChange={vi.fn()} />));
    fireEvent.change(screen.getByLabelText("Begrunnelse (påkrevd)"), { target: { value: REASON } });
    const btn = screen.getByRole("button", { name: "Hold hele kreditnotaen utenfor" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/bare lesetilgang/)).toBeInTheDocument();
  });
});

describe("FocusNotice kreditnota", () => {
  it("viser «Hold utenfor råvarebehandling» ved siden av kreditnotakoblingen", () => {
    const hold = vi.fn();
    render(wrap(<FocusNotice kind="kreditnota" backHref="/x" backLabel="Varekort" invoiceNumber="8050625" isCreditNote onCredit={vi.fn()} onHoldOutside={hold} />));
    expect(screen.getByRole("button", { name: "Koble til opprinnelig faktura" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hold utenfor råvarebehandling" }));
    expect(hold).toHaveBeenCalled();
  });
  it("uten skriverett vises ikke valget", () => {
    render(wrap(<FocusNotice kind="kreditnota" backHref="/x" backLabel="Varekort" invoiceNumber="8050625" isCreditNote onHoldOutside={null} />));
    expect(screen.queryByRole("button", { name: "Hold utenfor råvarebehandling" })).toBeNull();
  });
});

describe("parseExclusionResult", () => {
  it("streng: tomt/ukjent svar er ukjent, aldri utført", () => {
    expect(parseExclusionResult(null).kind).toBe("unknown");
    expect(parseExclusionResult({}).kind).toBe("unknown");
    expect(parseExclusionResult({ ok: false }).kind).toBe("unknown");
    const r = parseExclusionResult({ ok: false, error: "versjon_endret" });
    expect(r.kind === "rejected" && exclusionErrorText(r)).toMatch(/endret siden/);
  });
});
