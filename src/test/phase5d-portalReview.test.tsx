// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import SupplierPortal from "@/ravarer/pages/forhandlinger/SupplierPortal";
import LiveConfirmationPortal from "@/ravarer/pages/forhandlinger/LiveConfirmationPortal";
import {
  isRfqSubmitReceipt, liveSubmitReceipt, parseRfqBundle, rfqSubmissionState, uploadPdf,
} from "@/ravarer/pages/forhandlinger/portal/portalApi";

// Kun syntetiske svar; ingen ekte token, passord, opplasting eller innsending.
type Reply = { status: number; body: unknown } | "network";
const calls: { fn: string; body: Record<string, unknown> }[] = [];
let queue: Array<Reply | Promise<Reply>> = [];
beforeEach(() => {
  calls.length = 0; queue = [];
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ fn: url.split("/").pop() ?? "", body: typeof init.body === "string" ? JSON.parse(init.body) : {} });
    const r = await (queue.shift() ?? { status: 500, body: {} });
    if (r === "network") throw new TypeError("network");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path: string, el: JSX.Element, routePath: string) {
  render(<RouterProvider router={createMemoryRouter([{ path: routePath, element: el }], { initialEntries: [path] })} />);
}
async function login() {
  fireEvent.change(screen.getByLabelText("Passord"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Logg inn" }));
}
const item = (id: string) => ({ id, raw_material_id: "rm", raw_materials: { name: `Vare ${id}`, base_unit: "kg" } });
const rfq = (responses: unknown, items = [item("i1")]) => ({
  result: "ok", recipient_id: "rec-A", negotiation_id: "n1", negotiation_title: "Mel", response_deadline: null, supplier_name: "Lev", items, responses,
});
const priceInputs = () => screen.getAllByLabelText("Pris per pakning (NOK, eks. mva)") as HTMLInputElement[];

describe("portalApi strenge kontrakter", () => {
  it("manglende svarliste og duplikater avvises", () => {
    expect(parseRfqBundle({ ...rfq([]), responses: undefined })).toBeNull();
    expect(parseRfqBundle(rfq([], [item("i1"), item("i1")]))).toBeNull();
    expect(parseRfqBundle(rfq([{ negotiation_item_id: "i1" }, { negotiation_item_id: "i1" }]))).toBeNull();
    expect(parseRfqBundle(rfq([]))?.responses).toEqual([]);
  });
  it("innsendingskvitteringer må ha nøyaktig form", () => {
    expect(isRfqSubmitReceipt({ success: true, finalized: true }, true)).toBe(true);
    expect(isRfqSubmitReceipt({ success: true, finalized: false }, true)).toBe(false);
    expect(isRfqSubmitReceipt({ success: true }, false)).toBe(false);
    expect(liveSubmitReceipt({ success: true })).toBeNull();
    expect(liveSubmitReceipt({ success: true, all_confirmed: false })).toEqual({ allConfirmed: false });
  });
  it("delvis innsendt skilles fra helt innsendt", () => {
    const items = parseRfqBundle(rfq([], [item("a"), item("b")]))!.items;
    expect(rfqSubmissionState(items, [{ ...{ negotiation_item_id: "a", status: "submitted" } } as never])).toBe("partial");
  });
  it("ingen signert PUT etter avbrudd mens billetten ventes", async () => {
    let current = true;
    let release: (r: Reply) => void = () => undefined;
    queue.push(new Promise<Reply>((res) => { release = res; }));
    const p = uploadPdf("request-rfq-datasheet-upload", { token: "t" }, "i1", new File(["%PDF"], "a.pdf"), () => current);
    current = false;
    release({ status: 200, body: { result: "ok", path: "p", signedUrl: "https://example.invalid/put" } });
    expect(await p).toBe("cancelled");
    expect(calls).toHaveLength(1);
  });
});

describe("SupplierPortal gjennomgangsrettelser", () => {
  async function unknownDraft() {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfq([{ negotiation_item_id: "i1", offered_price: 300, status: "draft" }]) });
    await login();
    await screen.findByText("Vare i1");
    fireEvent.change(priceInputs()[0], { target: { value: "310" } });
    queue.push({ status: 502, body: {} });
    fireEvent.click(screen.getByRole("button", { name: /Lagre kladd/ }));
    await screen.findByText(/Vi vet ikke om kladden ble lagret/);
  }

  it("feilformet lesing beholder lås og kladd, og viser årsak", async () => {
    await unknownDraft();
    queue.push({ status: 200, body: { ...rfq([]), responses: undefined } });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByText(/Status kunne ikke leses/)).toBeTruthy();
    expect(priceInputs()[0].value).toBe("310");
    expect(priceInputs()[0].matches(":disabled")).toBe(true);
  });

  it("utløpt passord ved ny lesing vises i lastet portal", async () => {
    await unknownDraft();
    queue.push({ status: 401, body: { result: "password_expired" } });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByText(/Status kunne ikke leses/)).toBeTruthy();
    expect(screen.getByText(/Vi vet ikke om kladden ble lagret/)).toBeTruthy();
  });

  it("vellykket lesing uten innsending beholder siste redigerte verdi og låser opp", async () => {
    await unknownDraft();
    queue.push({ status: 200, body: rfq([{ negotiation_item_id: "i1", offered_price: 300, status: "draft" }]) });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByRole("button", { name: /Send tilbud/ })).toBeTruthy();
    expect(priceInputs()[0].value).toBe("310");
  });

  it("finalize med finalized:false er ukjent, ikke sendt", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfq([]) });
    await login();
    queue.push({ status: 200, body: { success: true, finalized: false } });
    fireEvent.click(await screen.findByRole("button", { name: /Send tilbud/ }));
    expect(await screen.findByText(/Vi vet ikke om tilbudet ble sendt/)).toBeTruthy();
    expect(screen.queryByText("Sendt — låst")).toBeNull();
  });

  it("delvis innsendt vises som delvis og forblir låst", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfq([{ negotiation_item_id: "a", offered_price: 1, status: "submitted" }], [item("a"), item("b")]) });
    await login();
    expect(await screen.findByText("Delvis sendt — må kontrolleres")).toBeTruthy();
    expect(screen.queryByText("Sendt — låst")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send tilbud/ })).toBeNull();
  });

  it("skjemaet er låst mens kladd lagres; frosset øyeblikksbilde sendes", async () => {
    mount("/tilbud/t1", <SupplierPortal />, "/tilbud/:token");
    queue.push({ status: 200, body: rfq([]) });
    await login();
    await screen.findByText("Vare i1");
    fireEvent.change(priceInputs()[0], { target: { value: "50" } });
    let release: (r: Reply) => void = () => undefined;
    queue.push(new Promise<Reply>((res) => { release = res; }));
    fireEvent.click(screen.getByRole("button", { name: /Lagre kladd/ }));
    expect(priceInputs()[0].matches(":disabled")).toBe(true);
    await act(async () => { release({ status: 200, body: { success: true, finalized: false } }); });
    const sent = calls.find((c) => c.fn === "submit-negotiation-response");
    expect((sent?.body.responses as Array<{ offered_price: number }>)[0].offered_price).toBe(50);
    expect(priceInputs()[0].matches(":disabled")).toBe(false);
  });
});

describe("LiveConfirmationPortal gjennomgangsrettelser", () => {
  const live = {
    result: "ok", recipient_id: "rec-A", negotiation_id: "n1", negotiation_title: "Live", confirmation_deadline: null, supplier_name: "Lev",
    items: [
      { id: "a", live_agreed_price: 1, live_status: "tentatively_agreed", raw_materials: { name: "Mel", base_unit: "kg" } },
      { id: "c", live_agreed_price: 2, live_status: "tentatively_agreed", raw_materials: { name: "Salt", base_unit: "kg" } },
    ],
  };

  it("success uten all_confirmed er ukjent og beholder kladden", async () => {
    localStorage.setItem("live-confirm-draft-t1", JSON.stringify({ states: {}, paymentDays: "" }));
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: live });
    await login();
    await screen.findByText("Live");
    queue.push({ status: 200, body: { success: true } });
    fireEvent.click(screen.getByRole("button", { name: /Send bekreftelse/ }));
    expect(await screen.findByText(/Vi vet ikke om bekreftelsen kom fram/)).toBeTruthy();
    expect(localStorage.getItem("live-confirm-draft-t1")).not.toBeNull();
  });

  it("statusavstemming beholder nyeste notat over eldre lokal kladd og viser lesefeil", async () => {
    localStorage.setItem("live-confirm-draft-t1", JSON.stringify({ states: { c: { supplier_note: "gammel" } }, paymentDays: "10" }));
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: live });
    await login();
    await screen.findByText("Live");
    const notes = screen.getAllByLabelText("Notat (valgfritt)") as HTMLTextAreaElement[];
    fireEvent.change(notes[1], { target: { value: "ny" } });
    fireEvent.change(screen.getByLabelText("Betalingsbetingelser (dager)"), { target: { value: "45" } });
    queue.push("network");
    fireEvent.click(screen.getByRole("button", { name: /Send bekreftelse/ }));
    await screen.findByText(/Vi vet ikke om bekreftelsen kom fram/);
    queue.push({ status: 401, body: { result: "wrong_password" } });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    expect(await screen.findByText(/Status kunne ikke leses/)).toBeTruthy();
    queue.push({ status: 200, body: { ...live, items: [{ ...live.items[0], live_status: "confirmed" }, live.items[1]] } });
    fireEvent.click(screen.getByRole("button", { name: /Les status på nytt/ }));
    await screen.findByRole("button", { name: /Send bekreftelse/ });
    expect((screen.getByLabelText("Notat (valgfritt)") as HTMLTextAreaElement).value).toBe("ny");
    expect((screen.getByLabelText("Betalingsbetingelser (dager)") as HTMLInputElement).value).toBe("45");
    expect(calls.filter((c) => c.fn === "submit-live-confirmation")).toHaveLength(1);
  });
});

describe("23e2-restfunn", () => {
  it("lenkebytte under ventende kladdlagring låser ikke den nye lenken", async () => {
    const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
    const router = createMemoryRouter([{ path: "/tilbud/:token", element: <SupplierPortal /> }], { initialEntries: ["/tilbud/t1"] });
    render(<RouterProvider router={router} />);
    queue.push({ status: 200, body: rfq([]) });
    await login();
    await screen.findByText("Vare i1");
    let release: (r: Reply) => void = () => undefined;
    queue.push(new Promise<Reply>((res) => { release = res; }));
    fireEvent.click(screen.getByRole("button", { name: /Lagre kladd/ }));
    await act(async () => { await router.navigate("/tilbud/t2"); });
    queue.push({ status: 200, body: { ...rfq([]), recipient_id: "rec-B", negotiation_id: "n2" } });
    await login();
    await screen.findByText("Vare i1");
    expect(priceInputs()[0].matches(":disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /Lagre kladd/ })).toBeTruthy();
    await act(async () => { release({ status: 200, body: { success: true, finalized: false } }); });
    expect(priceInputs()[0].matches(":disabled")).toBe(false);
  });

  it("opplasting og innsending i samme render: innsending sperres synkront", async () => {
    mount("/bekreftelse/t1", <LiveConfirmationPortal />, "/bekreftelse/:token");
    queue.push({ status: 200, body: { result: "ok", recipient_id: "rec-A", negotiation_id: "n1", negotiation_title: "Live", confirmation_deadline: null, supplier_name: "Lev",
      items: [{ id: "a", live_agreed_price: 1, live_status: "tentatively_agreed", raw_materials: { name: "Mel", base_unit: "kg" } }] } });
    await login();
    await screen.findByText("Live");
    queue.push(new Promise<Reply>(() => undefined)); // billett henger
    const file = document.querySelector('input[type="file"]') as HTMLInputElement;
    const send = screen.getByRole("button", { name: /Send bekreftelse/ });
    act(() => {
      fireEvent.change(file, { target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] } });
      fireEvent.click(send);
    });
    expect(calls.some((c) => c.fn === "submit-live-confirmation")).toBe(false);
  });
});
