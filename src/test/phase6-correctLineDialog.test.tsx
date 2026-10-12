// @vitest-environment jsdom
/**
 * Ekte CorrectLineDialog med mocket henting/lagring: identitet (faktura+linje) må stemme med frosset mål,
 * bare et vellykket og ferdig svar kan lagres, utkast beholdes ved ny henting, og innsending er synkront vaktet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

type Q = { data: unknown; isSuccess: boolean; isFetching: boolean; isError: boolean; isLoading: boolean; refetch: () => Promise<unknown> };
const st = vi.hoisted(() => ({ q: null as unknown as Q, mutate: vi.fn(), refetch: vi.fn() }));
vi.mock("@/ravarer/pages/priskontroll/faktura/useLineCorrection", () => ({
  useCorrectionLine: () => st.q,
  useCorrectLine: () => ({ mutateAsync: st.mutate, isPending: false }),
}));
vi.mock("@/ravarer/pages/priskontroll/faktura/ExtractionExamplesList", () => ({ ExtractionExamplesList: () => null }));

import { CorrectLineDialog } from "@/ravarer/pages/priskontroll/faktura/CorrectLineDialog";

const row = (over: Record<string, unknown> = {}) => ({
  id: "A", invoice_id: "I1", line_number: 2, updated_at: "v1", costPosted: false, issues: [],
  values: { supplier_sku: null, description: "HASSELNØTT", quantity: 10, unit: "kg", package_size: null, package_unit: null, count_per_package: null, unit_price: 113, total_amount: 1130, line_kind: "vare", unit_price_basis: "", discount_amount: null },
  ...over,
});
const ok = (data: unknown): Q => ({ data, isSuccess: true, isFetching: false, isError: false, isLoading: false, refetch: st.refetch });
const inv = (id = "I1") => ({ id, status: "pending", approved: false, supplier_id: "S1", supplier_name: "PALS" });

function view(props: Partial<Parameters<typeof CorrectLineDialog>[0]> = {}) {
  return render(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite document={<div />} onSaved={() => undefined} {...props} />);
}
const fillValid = () => {
  fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "Lest feil fra originalen" } });
  const qty = document.getElementById("rett-quantity") as HTMLInputElement;
  fireEvent.change(qty, { target: { value: "11" } });
};
const save = () => screen.getByRole("button", { name: "Lagre rettelsen" });

beforeEach(() => { cleanup(); st.mutate.mockReset(); st.refetch.mockReset(); st.q = ok(row()); });

describe("CorrectLineDialog: identitet og ferske data", () => {
  it("riktig faktura+linje og gyldig endring → lagrer med frosset linje og versjon", async () => {
    st.mutate.mockResolvedValue({ changed: ["quantity"], exampleId: null, remainingIssues: [], linesSumStatus: "ok" });
    view();
    fillValid();
    expect(save()).not.toBeDisabled();
    await act(async () => { fireEvent.click(save()); });
    expect(st.mutate).toHaveBeenCalledTimes(1);
    expect(st.mutate.mock.calls[0][0]).toMatchObject({ lineId: "A", invoiceId: "I1", expectedUpdatedAt: "v1" });
  });
  it("rad fra en annen faktura enn den som vises → ikke redigerbar, ingen lagring", () => {
    view({ invoice: inv("I2"), targetInvoiceId: "I1" });
    expect(screen.getByRole("alert").textContent).toMatch(/hører ikke til fakturaen/);
    expect(document.getElementById("rett-quantity")).toBeNull();
    expect(save()).toBeDisabled();
  });
  it("frosset mål for annen faktura enn gjeldende → ingen skjema", () => {
    view({ targetInvoiceId: "I0" });
    expect(document.getElementById("rett-quantity")).toBeNull();
  });
  it("feil linje-ID i svaret → ingen reserverad", () => {
    st.q = ok(row({ id: "B" }));
    view();
    expect(document.getElementById("rett-quantity")).toBeNull();
  });
  it("feilet ny henting med bufrede verdier → utkast beholdes, lagring sperret til vellykket svar", async () => {
    const { rerender } = view();
    fillValid();
    expect(save()).not.toBeDisabled();
    st.q = { ...ok(row()), isSuccess: false, isError: true, isFetching: false };
    rerender(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    expect(save()).toBeDisabled();
    expect((document.getElementById("rett-quantity") as HTMLInputElement).value).toBe("11");
    st.q = { ...ok(row()), isFetching: true };
    rerender(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    expect(save()).toBeDisabled();
    st.q = ok(row());
    rerender(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    expect((document.getElementById("rett-quantity") as HTMLInputElement).value).toBe("11");
    expect(save()).not.toBeDisabled();
  });
  it("ny versjon av raden → utkast beholdes, lagring sperret med «Last inn ferske verdier»", () => {
    const { rerender } = view();
    fillValid();
    st.q = ok(row({ updated_at: "v2" }));
    rerender(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    expect(save()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last inn ferske verdier" })).toBeTruthy();
  });
  it("gjeldende rettighet: skrivetilgang fjernet → lagring sperret", () => {
    const { rerender } = view();
    fillValid();
    rerender(<CorrectLineDialog open onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" invoice={inv()} canWrite={false} document={<div />} onSaved={() => undefined} />);
    expect(save()).toBeDisabled();
  });
  it("ført kostpris i ferskt svar → låst", () => {
    st.q = ok(row({ costPosted: true }));
    view();
    fillValid();
    expect(save()).toBeDisabled();
  });
  it("dobbeltklikk sender bare én gang", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    st.mutate.mockImplementation(() => new Promise((r) => { resolve = r; }));
    view();
    fillValid();
    await act(async () => { fireEvent.click(save()); fireEvent.click(save()); });
    expect(st.mutate).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ changed: [], exampleId: null, remainingIssues: [], linesSumStatus: "ok" }); });
  });
  it("korrigeringskontroller og lukkeknapp har 44 px-klasser", () => {
    view();
    expect(save().className).toContain("min-h-[44px]");
    expect(screen.getByRole("button", { name: "Avbryt" }).className).toContain("min-h-[44px]");
    expect((document.getElementById("rett-quantity") as HTMLElement).className).toContain("min-h-[44px]");
    const close = screen.getAllByRole("button", { name: "Lukk" })[0];
    expect(close.className).toContain("min-w-[44px]");
  });
  it("Escape fører fokus tilbake til åpneren når den fortsatt finnes", async () => {
    const opener = document.createElement("button"); opener.textContent = "Rett sumavvik"; document.body.appendChild(opener);
    let open = true;
    const { rerender } = render(<CorrectLineDialog open={open} onOpenChange={(v) => { open = v; }} lineId="A" targetInvoiceId="I1" returnFocus={() => opener} invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(open).toBe(false);
    await act(async () => {
      rerender(<CorrectLineDialog open={false} onOpenChange={() => undefined} lineId="A" targetInvoiceId="I1" returnFocus={() => opener} invoice={inv()} canWrite document={<div />} onSaved={() => undefined} />);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
