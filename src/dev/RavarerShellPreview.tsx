import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RavarerNavView } from "@/components/layout/SubAppNav";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { SectionTabs } from "@/ravarer/ui/SectionTabs";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import { parseWorkSummary } from "@/ravarer/lib/workRpc";
import "@/index.css";

/** Forhåndsvisning med faste data — innlogget skall kan ikke kjøres i preview. */
const summary = parseWorkSummary({
  invoice_access: true,
  todo_total: 12,
  invoices: { open_total: 7 },
  data_quality: { datasheet_changes: 3, missing_package: 4 },
  other: { agreements_expiring_30d: 2, stock_below_min: 5 },
});

function Preview() {
  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary">
      <RavarerNavView summary={summary} hasInvoiceAccess canManage />
      <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 sm:px-6 md:px-8">
        <ModulePage
          eyebrow="Råvarer"
          title="Priskontroll"
          subtitle="Fakturaer, varekoblinger og prisavvik på ett sted."
          icon={ScanSearch}
          tabs={
            <SectionTabs
              ariaLabel="Priskontroll"
              tabs={[
                { id: "gjore", label: "Å gjøre", count: 12, tone: "warning" },
                { id: "fakturaer", label: "Fakturaer", count: 7 },
                { id: "varekoblinger", label: "Varekoblinger" },
                { id: "godkjenning", label: "Godkjenning", count: 2 },
                { id: "saker", label: "Saker" },
              ]}
            />
          }
        >
          <ResultBox title="Ny pris godtatt for Hvetemel siktet" items={["4 åpne linjer oppdatert", "1 linje hoppet over (allerede ført)"]} onUndo={() => undefined} onNext={() => undefined} />
        </ModulePage>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={["/ravarer/priskontroll"]}>
        <Preview />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>,
);
