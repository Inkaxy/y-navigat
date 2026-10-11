import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import FakturaWorkspace from "@/ravarer/pages/priskontroll/faktura/FakturaWorkspace";
import "@/index.css";

/** Lokal sjekk av den EKTE fakturaarbeidsflaten med fast faktura i cache. Linjekøen krever innlogging og viser feil her. */
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
const line = (n: number, desc: string, total: number) => ({ id: `l${n}`, line_number: n, description: desc, total_amount: total, match_confidence: null, extraction_issues: [], requires_review: true, raw_materials: null });
qc.setQueryData(["invoice", "p1"], {
  id: "p1", legal_entity_id: "le-1", supplier_id: "s1", invoice_number: "526301", invoice_date: "2026-10-02", due_date: "2026-10-30", status: "needs_review",
  source: "tripletex", source_document_url: null, total_amount: 29652.45, total_vat: 3867.71, vat_inferred: false, lines_sum_excl_vat: 343103.5, lines_sum_variance_pct: 1230.6,
  lines_sum_status: "mismatch", extraction_confidence: 0.99, extraction_issues: [], line_extraction_status: "done", line_extraction_attempts: 1, line_extraction_error: null,
  lines_source: "pdf_extracted", reconciled_mode: null, is_credit_note: false, flagged_at: null, tripletex_voucher_number: "1234", tripletex_is_paid: false, paid_at: null,
  suppliers: { name: "A/S PALS", org_number: "912345678", contact_email: null }, legal_entities: { legal_name: "Nøtterø Bakeri" },
  invoice_lines: [line(1, "KARDEMOMME 1 HT", 81200), line(2, "VANILJESUKKER", 64000), line(3, "KANEL MALT", 197903.5)],
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><AuthProvider><TooltipProvider><MemoryRouter initialEntries={["/ravarer/priskontroll/faktura/p1?retur=fane%3Dgjore"]}>
    <div className="min-h-screen bg-background px-4 py-4 md:px-8"><Routes><Route path="/ravarer/priskontroll/faktura/:id" element={<FakturaWorkspace />} /></Routes></div>
  </MemoryRouter></TooltipProvider></AuthProvider></QueryClientProvider>,
);
