import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RavarerNavView } from "@/components/layout/SubAppNav";
import { HeaderView } from "@/ravarer/pages/oversikt/HeaderView";
import { KpiRowView } from "@/ravarer/pages/oversikt/KpiRowView";
import { ToDoListView } from "@/ravarer/pages/oversikt/ToDoListView";
import { ActivityView } from "@/ravarer/pages/oversikt/ActivityView";
import { PriceMoversView } from "@/ravarer/pages/oversikt/PriceMoversView";
import { DataQualityView } from "@/ravarer/pages/oversikt/DataQualityView";
import { FIXTURE_SUMMARY, FIXTURE_ITEMS, FIXTURE_ACTIVITY, FIXTURE_MOVERS } from "@/ravarer/pages/oversikt/fixtures";
import "@/index.css";

function Preview() {
  const [period, setPeriod] = useState<30 | 90 | 365>(30);
  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary">
      <RavarerNavView summary={FIXTURE_SUMMARY} hasInvoiceAccess canManage />
      <div className="mx-auto w-full max-w-[1280px] space-y-6 px-6 py-6">
        <HeaderView summary={FIXTURE_SUMMARY} firstName="Henrik" />
        <KpiRowView summary={FIXTURE_SUMMARY} movers={FIXTURE_MOVERS} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <ToDoListView data={FIXTURE_ITEMS} />
          <ActivityView data={FIXTURE_ACTIVITY} />
        </div>
        <PriceMoversView data={FIXTURE_MOVERS} period={period} onPeriodChange={setPeriod} />
        <DataQualityView dq={FIXTURE_SUMMARY.data_quality} supplier={FIXTURE_SUMMARY.supplier_items} stockBelowMin={5} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <MemoryRouter initialEntries={["/ravarer"]}>
        <Preview />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>,
);
