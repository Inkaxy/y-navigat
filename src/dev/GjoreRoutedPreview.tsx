import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GjoreWorkspace } from "@/ravarer/pages/priskontroll/gjore/GjoreWorkspace";
import { parseWorkItems } from "@/ravarer/lib/workRpc";
import "@/index.css";

/** Lokal sjekk av den EKTE Å gjøre-komponenten med fast cache. Ingen skriving; uhentede oppslag feiler stille. */
const LE = "le-1";
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
qc.setQueryData(["company"], { id: LE, legal_name: "Nøtterø Bakeri", display_name: "Nøtterø Bakeri", short_code: "NB", org_number: "", founded_year: null });
qc.setQueryData(["suppliers", LE], []);
const items = [
  { key: "faktura:p1", grp: "fakturaer", type: "faktura", kind: "faktura_sumavvik", supplier_name: "A/S PALS", invoice_id: "p1", invoice_number: "526301", title: "A/S PALS · faktura 526301", amount: 29652.45, impact_nok: 317318.76, last_date: "2026-10-02" },
  { key: "varekort:s2:sku:1", grp: "pakning", type: "varekort", kind: "mangler_pakning", supplier_name: "Idun Industri AS", item_key: "sku:1", title: "Idun Combisur Soft, sekk 20 kg", sku: "123456", open_lines: 7, open_invoices: 7, amount: 274385, impact_nok: 274385 },
  { key: "varekort:s3:sku:2", grp: "pris", type: "varekort", kind: "prisavvik", supplier_name: "Diplom-Is AS", item_key: "sku:2", title: "SOFTISMIKS UHT 5L", sku: "40213", open_lines: 2, open_invoices: 2, amount: 3136, impact_nok: 168, effect_status: "verified_price_effect", read_integrity: "checked" },
  { key: "varekort:s4:sku:3", grp: "kobling", type: "varekort", kind: "ukoblet", supplier_name: "Engrospartner", item_key: "sku:3", title: "KARDEMOMME 1 HT VARMEBE.", sku: "1182", open_lines: 3, open_invoices: 2, amount: 2100, impact_nok: 2100 },
  { key: "varekort:s5:sku:4", grp: "kontroll", type: "varekort", kind: "kontroll", supplier_name: "Tine SA", item_key: "sku:4", title: "Smør usaltet 10 kg", open_lines: 1, open_invoices: 1, amount: 900, impact_nok: null, read_integrity: "needs_review" },
];
qc.setQueryData(["ravarer", "work-items", LE, "alle", null, null, "impact", 50, 0],
  parseWorkItems({ total: 802, counts: { alle: 802, kobling: 354, pakning: 173, pris: 185, kontroll: 9, fakturaer: 81 }, items }));

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><TooltipProvider><MemoryRouter initialEntries={["/ravarer/priskontroll?fane=gjore"]}>
    <div className="min-h-screen bg-background px-4 py-6 md:px-8"><GjoreWorkspace /></div>
  </MemoryRouter></TooltipProvider></QueryClientProvider>,
);
