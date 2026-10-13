import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PriceBlockView, type BlockedRow, type PriceRow } from "@/ravarer/pages/priskontroll/gjore/PriceBlockView";
import { splitByGate } from "@/ravarer/pages/priskontroll/gjore/PriceBlock";
import { reasonGate } from "@/fakturaer/lib/priceSafety";
import { UNCHECKED } from "@/fakturaer/lib/priceSafety";
import { clarifyHref, clarifyReturn, startTarget, parseFocus } from "@/ravarer/pages/priskontroll/gjore/clarifyTarget";
import { detailCause } from "@/ravarer/pages/priskontroll/gjore/groupCopy";
import { FocusNotice } from "@/ravarer/pages/priskontroll/faktura/FocusNotice";
import { fakturaReturn } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { whatIsMissing, type SupplierItem } from "@/fakturaer/lib/supplierItems";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";

// Syntetisk kopi av Idun Combisur Soft sekk 20 kg: 7 linjer på 7 fakturaer, én gammel kreditnota.
const L = (id: string, nr: string, date: string) => ({ id, invoice_id: `inv-${nr}`, invoice_number: nr, invoice_date: date, quantity: 1, unit: "sekk" });
const LINES = [
  L("l1", "1542054", "2026-09-01"), L("l2", "1504396", "2026-07-15"), L("l3", "1511398", "2026-08-01"), L("l4", "1508247", "2026-07-25"),
  L("l5", "1495829", "2026-06-20"), L("l6", "1491126", "2026-06-10"), L("l7", "8050625", "2026-05-02"),
];
const CODE: Record<string, string> = { l1: "invoice_sum_not_verified", l2: "invoice_sum_not_verified", l3: "price_reference_unverified", l4: "price_reference_unverified", l5: "price_observation_held", l6: "price_reference_unverified", l7: "credit_note" };
const gateAll = (l: { id: string }): PriceGate => reasonGate(CODE[l.id]);
const RET = clarifyReturn("/ravarer/priskontroll", "?fane=gjore&gruppe=pris&valgt=vk%7Cs1%7Csku%3A12113&linje=l1");

function Harness(p: { rows?: PriceRow[]; blocked: BlockedRow[]; status?: "ready" | "loading" | "error"; selectedInvoiceId?: string | null; onRetry?: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <PriceBlockView rows={p.rows ?? []} blocked={p.blocked} status={p.status ?? "ready"} onRetry={p.onRetry} selected={new Set()} onToggle={() => undefined}
      hasAgreement={false} tolerancePct={3} hardCapPct={15} settings={null} reason={reason} onReason={setReason} canWrite busy={false}
      onAccept={() => undefined} onCase={() => undefined} onFixAgreement={() => undefined} onCheckPackage={() => undefined}
      hrefFor={(b) => clarifyHref(b, RET)} selectedInvoiceId={p.selectedInvoiceId ?? null} />
  );
}
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const mount = (ui: React.ReactNode) => render(
  <MemoryRouter initialEntries={["/ravarer/priskontroll?fane=gjore"]}>
    <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
  </MemoryRouter>,
);
const target = (href: string) => { const u = new URL(href, "http://x"); return { path: u.pathname, linje: u.searchParams.get("linje"), fokus: u.searchParams.get("fokus"), retur: u.searchParams.get("retur") }; };

describe("varekort: alle 7 linjer sperret", () => {
  const { rows, blocked } = splitByGate(LINES, gateAll);
  it("beholder serverens årsak og handling per linje", () => {
    expect(rows).toHaveLength(0);
    expect(blocked.map((b) => [b.reason, b.action])).toContainEqual(["credit_note", "review_credit_note"]);
    expect(blocked.find((b) => b.id === "l1")?.reason).toBe("invoice_sum_not_verified");
  });
  it("viser «Avklar før prisvurdering», Start avklaring på eldste og ingen prisknapper/begrunnelse", () => {
    mount(<Harness blocked={blocked} />);
    const box = screen.getByTestId("clarify-first");
    expect(within(box).getByText("Avklar før prisvurdering")).toBeTruthy();
    expect(box.textContent).toMatch(/2 fakturasum ikke kontrollert · 4 sammenligningspris må avklares · 1 kreditnota/);
    expect(screen.queryByRole("button", { name: /Godta ny pris/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Opprett leverandørsak/ })).toBeNull();
    expect(screen.queryByLabelText("Begrunnelse")).toBeNull();
    const start = within(box).getByRole("link", { name: /Start avklaring/ });
    expect(target(start.getAttribute("href")!)).toEqual({ path: "/ravarer/priskontroll/faktura/inv-8050625", linje: "l7", fokus: "kreditnota", retur: RET });
    expect(screen.getByRole("button", { name: "Flere valg" })).toBeTruthy();
  });
  it("hver linje har én årsaksspesifikk knapp til riktig faktura/linje/fokus med retur", () => {
    mount(<Harness blocked={blocked} />);
    const href = (name: RegExp) => target(screen.getByRole("link", { name }).getAttribute("href")!);
    expect(href(/Kontroller fakturasummen: faktura 1542054/)).toEqual({ path: "/ravarer/priskontroll/faktura/inv-1542054", linje: null, fokus: "sum", retur: RET });
    expect(href(/Kontroller fakturasummen: faktura 1504396/).path).toBe("/ravarer/priskontroll/faktura/inv-1504396");
    for (const nr of ["1511398", "1508247", "1495829", "1491126"]) {
      const t = href(new RegExp(`Kontroller sammenligningsprisen: faktura ${nr}`));
      expect(t.fokus).toBe("prisgrunnlag"); expect(t.path).toBe(`/ravarer/priskontroll/faktura/inv-${nr}`);
    }
    expect(href(/Kontroller kreditnotaen: faktura 8050625/).fokus).toBe("kreditnota");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });
  it("klikk navigerer til målet", () => {
    mount(<Harness blocked={blocked} />);
    fireEvent.click(screen.getByRole("link", { name: /Kontroller fakturasummen: faktura 1542054/ }));
    expect(screen.getByTestId("where").textContent).toMatch(/^\/ravarer\/priskontroll\/faktura\/inv-1542054\?fokus=sum&retur=/);
  });
  it("valgt original vises først og merkes; bytte flytter merket", () => {
    const { rerender } = mount(<Harness blocked={blocked} selectedInvoiceId="inv-1542054" />);
    expect(screen.getAllByRole("listitem")[0].getAttribute("data-invoice")).toBe("1542054");
    expect(within(screen.getAllByRole("listitem")[0]).getByText("Vises i originalen")).toBeTruthy();
    rerender(<MemoryRouter><Harness blocked={blocked} selectedInvoiceId="inv-8050625" /></MemoryRouter>);
    expect(screen.getAllByRole("listitem")[0].getAttribute("data-invoice")).toBe("8050625");
  });
});

const ROW: PriceRow = { id: "ok1", invoice_id: "inv-9", invoice_number: "1550000", invoice_date: "2026-09-20", quantity: 2, unit: "sekk", price_per_base_unit: 30, expected_price_per_base_unit: 28,
  base_quantity: 40, effect_nok: 80, reference_source: "last_purchase", reference_id: "r", raw_material_id: "rm", base_unit: "kg", reference_date: "2026-09-01" };

describe("blandet, lasting og feil", () => {
  const { blocked } = splitByGate(LINES, gateAll);
  it("blandet: klare prislinjer og alle blokkerte vises, utkast bevares ved bytte av original", () => {
    function Swap() { const [sel, setSel] = useState("inv-1542054"); return <><button onClick={() => setSel("inv-8050625")}>bytt</button><Harness rows={[ROW]} blocked={blocked} selectedInvoiceId={sel} /></>; }
    mount(<Swap />);
    expect(screen.queryByTestId("clarify-first")).toBeNull();
    expect(screen.getByRole("button", { name: /Godta ny pris/ })).toBeTruthy();
    expect(screen.getByText("7 linjer kan ikke sammenlignes nå")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /1550000/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "Ny prisliste" } });
    fireEvent.click(screen.getByText("bytt"));
    expect((screen.getByLabelText("Begrunnelse") as HTMLTextAreaElement).value).toBe("Ny prisliste");
    expect(screen.getAllByRole("listitem")[0].getAttribute("data-invoice")).toBe("8050625");
  });
  it("lasting: ingen prisgodkjenning", () => {
    mount(<Harness blocked={[]} status="loading" />);
    expect(screen.getByRole("status").textContent).toMatch(/ikke kontrollert ennå/);
    expect(screen.queryByRole("button", { name: /Godta ny pris/ })).toBeNull();
  });
  it("feil: Prøv igjen og ingen prisgodkjenning", () => {
    let n = 0;
    mount(<Harness blocked={[]} status="error" onRetry={() => { n++; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(n).toBe(1);
    expect(screen.queryByRole("button", { name: /Godta ny pris/ })).toBeNull();
  });
  it("ukjent prisstatus på en linje gir Prøv igjen, ikke lenke", () => {
    const { blocked: b } = splitByGate([LINES[0]], () => UNCHECKED);
    let n = 0;
    mount(<Harness blocked={b} onRetry={() => { n++; }} />);
    fireEvent.click(screen.getByRole("button", { name: /Prøv igjen: faktura 1542054/ }));
    expect(n).toBe(1);
  });
});

describe("overskrift og retur", () => {
  it("gammel kreditnota merker ikke hele varekortet", () => {
    const d = detailCause({ type: "varekort", kind: "prisavvik", action_required: "review_credit_note", open_lines: 7, open_invoices: 7 });
    expect(d.cause).not.toMatch(/Kreditnota/);
    expect(d.cause).toMatch(/7 åpne linjer på 7 fakturaer/);
    expect(d.next).not.toMatch(/kreditnota/i);
    expect(detailCause({ type: "faktura", kind: "faktura_flagget", action_required: "review_credit_note", open_lines: 1, open_invoices: 1 }).cause).toBe("Kreditnota – ikke en prisendring");
  });
  it("«Hva mangler» påstår ikke bekreftede prisavvik", () => {
    const t = whatIsMissing({ status: "prisavvik", open_lines: 7, rm_name: "Combisur" } as SupplierItem);
    expect(t).not.toMatch(/avviker fra prisgrunnlaget/);
    expect(t).toMatch(/mulig prisavvik/);
  });
  it("retur går tilbake til eksakt varekort i arbeidsbordet eller på egen side", () => {
    expect(fakturaReturn(RET).href).toBe(`/ravarer/priskontroll${RET}`);
    expect(fakturaReturn(RET).label).toBe("Å gjøre");
    const own = clarifyReturn("/ravarer/priskontroll/varekort/s1/sku%3A12113", "")!;
    expect(fakturaReturn(own)).toEqual({ href: "/ravarer/priskontroll/varekort/s1/sku%3A12113", label: "Varekort" });
    expect(fakturaReturn("//evil.com").href).toBe("/ravarer/priskontroll?fane=fakturaer");
  });
  it("startTarget: eldste gyldige dato, ukjent status sist", () => {
    const { blocked } = splitByGate(LINES, (l) => (l.id === "l7" ? UNCHECKED : gateAll(l)));
    expect(startTarget(blocked)?.invoice_number).toBe("1491126");
    expect(parseFocus("x")).toBeNull();
  });
});

describe("fokus på fakturasiden", () => {
  const base = { backHref: "/ravarer/priskontroll?fane=gjore", backLabel: "Å gjøre", invoiceNumber: "1542054" };
  it("sum: synlig overskrift, sumkontroll og tilbake", () => {
    let opened = 0;
    render(<MemoryRouter><FocusNotice {...base} kind="sum" isCreditNote={false} onOpenControl={() => { opened++; }} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Kontroller fakturasummen" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vis sumkontrollen" }));
    expect(opened).toBe(1);
    expect(screen.getByRole("link", { name: "Tilbake til å gjøre" }).getAttribute("href")).toBe(base.backHref);
  });
  it("kreditnota på vanlig faktura påstår ikke kreditnota", () => {
    render(<MemoryRouter><FocusNotice {...base} kind="kreditnota" isCreditNote={false} onCredit={() => undefined} /></MemoryRouter>);
    expect(screen.getByText(/ikke registrert som kreditnota/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Koble til opprinnelig/ })).toBeNull();
  });
  it("prisgrunnlag lenker til råvarens prisdel", () => {
    render(<MemoryRouter><FocusNotice {...base} kind="prisgrunnlag" isCreditNote={false} priceBasisHref="/ravarer/varer/rm?seksjon=pris" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Se prisgrunnlaget på råvaren" }).getAttribute("href")).toBe("/ravarer/varer/rm?seksjon=pris");
  });
});
