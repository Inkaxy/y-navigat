import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import type { OverviewRow } from "@/fakturaer/lib/approval";
import { blockerLabel } from "@/fakturaer/lib/approval";
import { formatMoney } from "@/fakturaer/lib/constants";
import { labelFor, SUPPLIER_CASE_STATUS_LABELS } from "@/ravarer/lib/labels";
import { FilterChips } from "@/ravarer/ui/FilterChips";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { approvalSteps, type ApprovalDelivery } from "@/ravarer/pages/priskontroll/godkjenning/useGodkjenning";
import { countByStatus, GODKJENNING_LABEL, GODKJENNING_STATUSER } from "@/ravarer/pages/priskontroll/godkjenning/approvalLogic";
import { caseSums, countSaker, isFollowUpDue, SAK_FILTER_LABEL, SAK_FILTRE } from "@/ravarer/pages/priskontroll/saker/caseLogic";
import "@/index.css";

/** Forhåndsvisning med faste testdata — ingen serverkall. */
const r = (p: Partial<OverviewRow>): OverviewRow => ({
  invoice_id: "x", invoice_number: "", invoice_date: "2026-10-06", supplier_id: "s", supplier_name: "", total_amount: 0, total_vat: 0, currency: "NOK",
  status: "reconciled", is_credit_note: false, approved_at: null, approved_by: null, blockers: [], open_material_lines: 0, cost_posted_lines: 0, cost_line_total: 3, ...p,
});
const ROWS: OverviewRow[] = [
  r({ invoice_id: "1", invoice_number: "1515620", supplier_name: "Idun Industri AS", total_amount: 33120, total_vat: 6624 }),
  r({ invoice_id: "2", invoice_number: "88123", supplier_name: "Tine SA", total_amount: 9880, total_vat: 1235 }),
  r({ invoice_id: "3", invoice_number: "526301", supplier_name: "A/S PALS", total_amount: 18452, total_vat: 3690, status: "pending", blockers: ["sumavvik"] }),
  r({ invoice_id: "4", invoice_number: "771204", supplier_name: "Diplom-Is AS", total_amount: 4312.5, total_vat: 862, status: "pending", blockers: ["prisavvik", "leverandorsak"] }),
  r({ invoice_id: "5", invoice_number: "40021", supplier_name: "Engrospartner", total_amount: 12004, total_vat: 2400, approved_at: "2026-10-09T13:05:00Z", approved_by: "u" }),
];
const DEL: ApprovalDelivery = { received_at: "2026-10-06", lines_sum_status: "ok", reconciled_mode: "auto", line_extraction_status: "done", lines_source: "pdf", flagged: false, line_count: 6 };
const del = (o: OverviewRow): ApprovalDelivery => (o.blockers.includes("sumavvik") ? { ...DEL, lines_sum_status: "mismatch" } : DEL);

const CASES = [
  { id: "a", title: "Prisøkning softismiks oktober", supplier: "Diplom-Is AS", status: "open", follow_up_on: "2026-10-05", ansvarlig: "Henrik Næss" },
  { id: "b", title: "Feil pris kardemomme", supplier: "Idun Industri AS", status: "open", follow_up_on: "2026-10-20", ansvarlig: "—" },
  { id: "c", title: "Kreditt for skadet levering", supplier: "Tine SA", status: "resolved", follow_up_on: null, ansvarlig: "Henrik Næss" },
];
const SUMS = caseSums(
  [{ case_id: "a", amount_excl_vat: 1240.5 }, { case_id: "a", amount_excl_vat: 310 }, { case_id: "b", amount_excl_vat: 412 }, { case_id: "c", amount_excl_vat: 980 }],
  [{ case_id: "a", amount_excl_vat: 500 }, { case_id: "c", amount_excl_vat: 980 }],
);
const TODAY = "2026-10-11";
const kr = (v: number) => formatMoney(v, "NOK");

function App() {
  const counts = countByStatus(ROWS);
  const sc = countSaker(CASES, TODAY);
  return (
    <div className="min-h-screen space-y-10 bg-background p-4 md:p-8">
      <section className="space-y-3">
        <h1 className="font-display text-title">Priskontroll · Godkjenning</h1>
        <FilterChips chips={GODKJENNING_STATUSER.map((s) => ({ id: s, label: GODKJENNING_LABEL[s], count: counts[s] }))} value="klare" onChange={() => undefined} />
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-caption text-muted-foreground"><tr>{["", "Leverandør", "Fakturanr", "Dato", "Beløp", "Leveransestatus", "Blokkert av", "Godkjent av/når"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{ROWS.map((o) => (
              <tr key={o.invoice_id} className="border-t border-border align-top">
                <td className="p-2"><input type="checkbox" aria-label={`Velg ${o.invoice_number}`} defaultChecked={o.invoice_id === "1" || o.invoice_id === "2"} /></td>
                <td className="p-2 font-medium">{o.supplier_name}</td><td className="p-2">{o.invoice_number}</td><td className="p-2">6. okt 2026</td>
                <td className="p-2 tabular-nums">{formatMoney(o.total_amount, "NOK")}</td>
                <td className="p-2"><DeliveryTimeline steps={approvalSteps(o, del(o))} /></td>
                <td className="p-2 text-caption text-warning">{o.blockers.map(blockerLabel).join(" · ") || "—"}</td>
                <td className="p-2 text-caption">{o.approved_at ? "Henrik Næss · fre 9. okt 2026, 15:05" : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
          <span className="text-sm"><strong>2</strong> valgt · {kr(43000)} inkl. mva.</span><span className="flex-1" />
          <Button size="sm">Godkjenn valgte (2)</Button><Button size="sm" variant="outline" disabled>Før kostpris for trygge linjer (0)</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h1 className="font-display text-title">Priskontroll · Leverandørsaker</h1>
        <FilterChips chips={SAK_FILTRE.map((f) => ({ id: f, label: SAK_FILTER_LABEL[f], count: sc[f] }))} value="apne" onChange={() => undefined} />
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-caption text-muted-foreground"><tr>{["Tittel", "Leverandør", "Status", "Krav", "Kreditert", "Gjenstår", "Ansvarlig", "Oppfølging"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{CASES.map((c) => {
              const s = SUMS.get(c.id) ?? { krav: 0, kreditert: 0, gjenstar: 0 };
              const m = labelFor(SUPPLIER_CASE_STATUS_LABELS, c.status);
              return (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-2 font-medium">{c.title}</td><td className="p-2">{c.supplier}</td><td className="p-2"><StatusPill label={m.label} tokenVar={m.tokenVar} /></td>
                  <td className="p-2 tabular-nums">{kr(s.krav)}</td><td className="p-2 tabular-nums">{kr(s.kreditert)}</td><td className="p-2 tabular-nums">{kr(s.gjenstar)}</td>
                  <td className="p-2">{c.ansvarlig}</td>
                  <td className={`p-2 ${isFollowUpDue(c, TODAY) ? "font-medium text-destructive" : ""}`}>{c.follow_up_on ?? "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><TooltipProvider><App /></TooltipProvider></MemoryRouter></QueryClientProvider>,
);
