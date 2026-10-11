import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RavarerStaticProvider } from "@/ravarer/context/RavarerContext";
import { InvoiceReceiptPanel } from "@/ravarer/pages/varemottak/InvoiceReceiptPanel";
import { CountSubmissionBanner, DraftSaveStatus } from "@/ravarer/pages/varetelling/CountPanels";
import { CountRejectedError, type PendingCountSubmission } from "@/ravarer/lib/countSubmission";
import { CountLineCard } from "@/ravarer/pages/varetelling/CountLineCard";
import { MobileKpis } from "@/ravarer/components/stock/MobileKpis";
import { emptyRow, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import type { ReceiptLine } from "@/ravarer/hooks/useGoodsReceipt";

/**
 * SKRIVEBESKYTTET FORHÅNDSVISNING — oppdiktede eksempelverdier, ingen nettverk, ingen mottak/telling/utkast.
 * Viser faktisk mottakspanel (mobil/desktop-oppsett) og faktiske tellestatuspaneler for 390/1440-kontroll.
 */
const base = { requires_review: false, not_applicable: false, is_credit_note: false, total_amount: null, line_number: null } as const;
const lines: ReceiptLine[] = [
  { ...base, id: "fx-1", description: "COCA-COLA 0,5L PET 24-PAKNING (eksempel)", raw_material_id: "fx-rm-1", raw_material_name: "Coca-Cola 0,5 l (eksempel)", stock_tracking: true,
    quantity: 48, unit: "stk", base_quantity: null, base_unit: "stk", receipt: { status: "ok", value: null }, movement: { status: "ok", value: { quantity_base: 48, types: ["purchase"] } } },
  { ...base, id: "fx-2", description: "Sjokoladeplate 100 g (eksempel)", raw_material_id: "fx-rm-2", raw_material_name: "Sjokolade (eksempel)", stock_tracking: true,
    quantity: 12, unit: "stk", base_quantity: 12, base_unit: "stk", receipt: { status: "ok", value: { quantity_base: 12, received_at: "2026-10-10T08:00:00Z", lot_id: null } }, movement: { status: "ok", value: { quantity_base: 12, types: ["purchase"] } } },
  { ...base, id: "fx-3", description: "Frakt (eksempel)", raw_material_id: null, raw_material_name: null, stock_tracking: false,
    quantity: 1, unit: "stk", base_quantity: null, base_unit: null, receipt: { status: "ok", value: null }, movement: { status: "ok", value: null } },
];
const pending: PendingCountSubmission = {
  legalEntityId: "preview-entity", opId: "preview-op", note: "Eksempeltelling", sentAt: "2026-10-11T12:00:00Z",
  lines: [{ raw_material_id: "fx-rm-1", counted_base: 40, expected_base: 48, line_note: null, location: null }],
};

export default function LagerPreviewContent() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } }));
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState("Ingen handling ennå.");
  // Bare lokal visningstilstand for tellekortet; ingenting lagres.
  const [loc, setLoc] = useState("");
  const [lineNote, setLineNote] = useState("");
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  return (
    <QueryClientProvider client={client}>
      <RavarerStaticProvider canWrite>
        <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-6">
          <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Forhåndsvisning med oppdiktede eksempelverdier. Ingenting lagres, mottas, telles eller sendes.
          </p>
          <p className="text-sm text-ink-secondary" data-testid="preview-last">{last}</p>
          <CountSubmissionBanner pending={pending} state={{ kind: "unknown" }} onRetry={() => setLast("Ville sendt samme telling på nytt.")} onRelease={() => undefined} canWrite />
          <CountSubmissionBanner pending={pending} state={{ kind: "rejected", error: new CountRejectedError("content", "Operasjons-ID-en er allerede brukt med et annet innhold."), reconciliation: "none" }}
            onRetry={() => undefined} onRelease={() => setLast("Ville frigjort.")} onReconcile={() => setLast("Ville lest den opprinnelige tellingen.")} canWrite />
          <MobileKpis testId="preview-kpis-videresalg" secondaryLabel="Flere nøkkeltall"
            primary={[{ label: "Videresalg under minimum", value: "3", tone: "warning" }, { label: "Oversolgt", value: "1", tone: "destructive" }]}
            secondary={[{ label: "Handelsvarer med lager", value: "42" }, { label: "Lagerverdi (videresalg)", value: "18 450,25 kr" }, { label: "Under minimum (alle lagerførte)", value: "7" }]} />
          <MobileKpis testId="preview-kpis-alle" secondaryLabel="Lagerverdi"
            primary={[{ label: "Lagerførte varer", value: "…" }, { label: "Under minimum", value: "–" }]}
            secondary={[{ label: "Samlet lagerverdi", value: "–" }]} />
          <CountLineCard
            row={{ raw_material_id: "fx-rm-3", name: "Hvetemel siktet, spesial 25 kg sekk (eksempel)", current_stock: 112.5, base_unit: "kg", current_cost_price: 9.4 }}
            unitText="4,50 sekk" frozenBase={100} onUseNewStock={() => setLast("Ville brukt ny beholdning.")}
            location={loc} onLocation={setLoc} note={lineNote} onNote={setLineNote} rows={rows} onRows={setRows} units={[]} diff={-2.5} />
          <DraftSaveStatus hasDraft server="failed" localFailed />
          {!open && <button type="button" className="min-h-[44px] rounded-md border border-border px-3 text-sm" onClick={() => setOpen(true)}>Åpne mottaket igjen</button>}
          <InvoiceReceiptPanel invoiceId={open ? "fx-invoice" : null} invoiceNumber="9205352553 (eksempel)" onClose={() => setOpen(false)} canWrite fixture={{ lines, onAction: setLast }} />
        </div>
      </RavarerStaticProvider>
    </QueryClientProvider>
  );
}
