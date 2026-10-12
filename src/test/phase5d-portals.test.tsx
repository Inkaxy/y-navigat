// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import { toast } from "sonner";
import SupplierPortal from "@/ravarer/pages/forhandlinger/SupplierPortal";
import LiveConfirmationPortal from "@/ravarer/pages/forhandlinger/LiveConfirmationPortal";

type Reply = { status: number; body: unknown } | "network";
const calls: { fn: string; body: Record<string, unknown> }[] = [];
let queue: Array<Reply | Promise<Reply>> = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  calls.length = 0; queue = [];
  localStorage.clear();
  vi.mocked(toast.error).mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ fn: url.split("/").pop() ?? "", body: JSON.parse(String(init.body)) });
    const r = await (queue.shift() ?? { status: 500, body: {} });
    if (r === "network") throw new TypeError("network");
    return json(r.status, r.body);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path: string, el: JSX.Element, routePath: string) {
  const router = createMemoryRouter([{ path: routePath, element: el }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
async function login() {
  fireEvent.change(screen.getByLabelText("Passord"), { target: { value: "abc123" } });
  fireEvent.click(screen.getByRole("button", { name: "Logg inn" }));
}

const rfqOk = {
  result: "ok", recipient_id: "rec-A", negotiation_id: "n1", negotiation_title: "Mel 2027", response_deadline: null, supplier_name: "Lev A",
  items: [{ id: "i1", raw_material_id: "rm1", expected_annual_volume: 1000, expected_annual_volume_unit: "kg", suggested_package_size: 25, suggested_package_unit: "kg", raw_materials: { name: "Hvetemel", base_unit: "kg" } }],
  responses: [
    { negotiation_item_id: "i1", offered_price: 300, status: "draft" },
    { negotiation_item_id: "foreign", offered_price: 1, status: "submitted" },
  ],
};

describe("SupplierPortal", () => {
  it("viser kjent avvisning ved innlogging", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 401, body: { result: "wrong_password" } });
    await login();
    expect(await screen.findByText("Feil passord")).toBeTruthy();
  });

  it("ignorerer svar for fremmede linjer og viser prisen per pakning", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfqOk });
    await login();
    const price = await screen.findByLabelText("Pris per pakning (NOK, eks. mva)");
    expect((price as HTMLInputElement).value).toBe("300");
    // Fremmed «submitted» låser ikke skjemaet.
    expect(screen.getByRole("button", { name: /Send tilbud/ })).toBeTruthy();
  });

  it("dobbeltklikk sender bare én gang, og ukjent utfall låser til ny lesing", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfqOk });
    await login();
    const send = await screen.findByRole("button", { name: /Send tilbud/ });
    let release: (r: Reply) => void = () => undefined;
    queue.push(new Promise<Reply>((res) => { release = res; }));
    fireEvent.click(send); fireEvent.click(send);
    await act(async () => { release("network"); });
    expect(calls.filter((c) => c.fn === "submit-negotiation-response")).toHaveLength(1);
    expect(await screen.findByText(/Vi vet ikke om tilbudet ble sendt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send tilbud/ })).toBeNull();
    expect((screen.getByLabelText("Pris per pakning (NOK, eks. mva)") as HTMLInputElement).matches(":disabled")).toBe(true);
    // Ny lesing er en lesing, ikke en ny innsending.
    queue.push({ status: 200, body: { ...rfqOk, responses: [{ negotiation_item_id: "i1", offered_price: 300, status: "submitted" }] } });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByText("Sendt — låst")).toBeTruthy();
    expect(calls.map((c) => c.fn)).toEqual(["validate-rfq-access", "submit-negotiation-response", "validate-rfq-access"]);
  });

  it("kjent already_submitted låser skjemaet til status er lest (ingen kvittering antas)", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfqOk });
    await login();
    queue.push({ status: 409, body: { result: "already_submitted" } });
    fireEvent.click(await screen.findByRole("button", { name: /Lagre kladd/ }));
    expect(await screen.findByRole("button", { name: /Les status på nytt/ })).toBeTruthy();
    expect(screen.queryByText("Sendt — låst")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Tilbudet er allerede sendt og låst.");
  });

  it("sent svar etter lenkebytte vises ikke", async () => {
    const router = mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    let release: (r: Reply) => void = () => undefined;
    queue.push(new Promise<Reply>((res) => { release = res; }));
    await login();
    await act(async () => { await router.navigate("/tilbud/t2"); });
    await act(async () => { release({ status: 200, body: rfqOk }); });
    expect(screen.queryByText("Mel 2027")).toBeNull();
    expect(screen.getByRole("button", { name: "Logg inn" })).toBeTruthy();
  });
});

const liveOk = {
  result: "ok", recipient_id: "rec-A", negotiation_id: "n1", negotiation_title: "Live mel", confirmation_deadline: null, supplier_name: "Lev A",
  items: [
    { id: "a", live_agreed_price: 12.5, live_agreed_price_unit: "kg", live_status: "tentatively_agreed", raw_materials: { name: "Mel", base_unit: "kg" } },
    { id: "b", live_agreed_price: 8, live_agreed_price_unit: "kg", live_status: "confirmed", raw_materials: { name: "Sukker", base_unit: "kg" } },
  ],
};

describe("LiveConfirmationPortal", () => {
  it("gjenoppretter bare kladd for egne linjer og sender aldri låste linjer", async () => {
    localStorage.setItem("live-confirm-draft-t1", JSON.stringify({ states: { a: { confirmed: true, datasheet_skipped: true, supplier_note: "ok" }, zz: { confirmed: true } }, paymentDays: "30" }));
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: liveOk });
    await login();
    await screen.findByText("Live mel");
    queue.push({ status: 200, body: { success: true, all_confirmed: true } });
    fireEvent.click(screen.getByRole("button", { name: /Send bekreftelse/ }));
    expect(await screen.findByText("Takk for bekreftelsen")).toBeTruthy();
    const sent = calls.find((c) => c.fn === "submit-live-confirmation");
    expect(sent?.body.items).toEqual([{ negotiation_item_id: "a", confirmed: true, supplier_note: "ok", datasheet_path: null, datasheet_skipped: true }]);
    expect(sent?.body.payment_terms_days).toBe(30);
    expect(localStorage.getItem("live-confirm-draft-t1")).toBeNull();
  });

  it("ugyldige betalingsdager stopper innsending", async () => {
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: liveOk });
    await login();
    fireEvent.change(await screen.findByLabelText("Betalingsbetingelser (dager)"), { target: { value: "-4" } });
    fireEvent.click(screen.getByRole("button", { name: /Send bekreftelse/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(calls.some((c) => c.fn === "submit-live-confirmation")).toBe(false);
  });

  it("ukjent utfall beholder kladd og låser uten nytt kall", async () => {
    localStorage.setItem("live-confirm-draft-t1", JSON.stringify({ states: { a: { confirmed: true, datasheet_skipped: true } }, paymentDays: "" }));
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: liveOk });
    await login();
    await screen.findByText("Live mel");
    queue.push({ status: 502, body: { error: "internal_error" } });
    fireEvent.click(screen.getByRole("button", { name: /Send bekreftelse/ }));
    expect(await screen.findByText(/Vi vet ikke om bekreftelsen kom fram/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send bekreftelse/ })).toBeNull();
    expect(localStorage.getItem("live-confirm-draft-t1")).not.toBeNull();
    expect(calls.filter((c) => c.fn === "submit-live-confirmation")).toHaveLength(1);
  });

  it("feil lesesvar gir feilmelding, ikke tom portal", async () => {
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: { result: "ok", items: "x" } });
    await login();
    expect(await screen.findByText(/Uventet svar fra tjenesten/)).toBeTruthy();
  });
});
