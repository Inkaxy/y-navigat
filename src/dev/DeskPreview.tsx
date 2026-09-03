import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AlertCircle, CalendarClock, CheckCircle2, Globe, Mail, MapPinOff, Repeat, TruckIcon, UserSquare } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrderDeskHeader } from "@/ordre/components/dashboard/OrderDeskHeader";
import { OrderDeskKpi, OrderDeskSplitKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { WorkQueueCard } from "@/ordre/components/dashboard/WorkQueueCard";
import { AutomationRunsCard } from "@/ordre/components/dashboard/AutomationRunsCard";
import type { DeskGroup } from "@/ordre/hooks/useOrderDeskBoard";
import "@/index.css";

const groups: DeskGroup[] = [
  {
    key: "approvals",
    label: "Ordre til godkjenning",
    rows: [
      { id: "order-1", to: "/x", primary: "Rema 1000 Teie", secondary: "10021 · #4711", badge: "Venter godkjenning", tone: "critical", meta: "2026-02-05" },
      { id: "order-2", to: "/x", primary: "Kiwi Nøtterøy avdeling Borgheim med langt navn", secondary: "10022 · #4712", badge: "Venter godkjenning", tone: "critical", meta: "2026-02-05" },
    ],
    total: 7,
    to: "/ordre/ordrer?status=awaiting_confirmation",
    toLabel: "Godkjenningskø",
    emptyText: "Ingen ordre venter på godkjenning.",
  },
  {
    key: "tickets",
    label: "E-post som krever handling",
    rows: [
      { id: "ticket-1", to: "/x", primary: "Endring på bestilling til fredag", secondary: "post@kunde.no", badge: "Haster", tone: "critical", meta: "for 12 min siden" },
      { id: "ticket-2", to: "/x", primary: "Kake til bursdag – kan vi få skrift på?", secondary: "Marianne Olsen", badge: "Uten ansvarlig", tone: "warning", meta: "for 1 t siden" },
    ],
    total: 5,
    to: "/ordre/ticket",
    toLabel: "Åpne innboks",
    emptyText: "Ingen e-post krever handling nå.",
  },
];

function noop() {}

function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <div className="container mx-auto space-y-6 px-page py-6 sm:px-page">
          <OrderDeskHeader date={new Date()} dataUpdatedAt={Date.now()} onRefresh={noop} />
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <OrderDeskKpi label="Til godkjenning" value={7} sub="ordre venter" icon={CheckCircle2} tone="critical" to="/x" />
            <OrderDeskKpi label="Nye e-poster" value={3} sub="12 åpne" icon={Mail} tone="info" to="/x" />
            <OrderDeskSplitKpi
              label="Ansvar e-post"
              icon={UserSquare}
              left={{ label: "Mine", value: 4, to: "/x", tone: "default" }}
              right={{ label: "Uten ansvarlig", value: 2, to: "/x", tone: "warning" }}
            />
            <OrderDeskKpi label="Nettbutikk" value={2} sub="til behandling" icon={Globe} tone="warning" to="/x" />
            <OrderDeskKpi label="Fastordre" value={11} sub="i morgen, ikke kjørt" icon={Repeat} tone="warning" to="/x" />
            <OrderDeskKpi label="Uten tur i dag" value={1} sub="må plasseres" icon={MapPinOff} tone="critical" to="/x" />
            <OrderDeskKpi label="Levering i dag" value={48} sub="128 450,00 kr" icon={TruckIcon} to="/x" />
            <OrderDeskKpi label="Levering i morgen" value={52} sub="141 900,00 kr" icon={CalendarClock} to="/x" />
          </section>
          <section className="grid gap-6 xl:grid-cols-3">
            <WorkQueueCard
              title="Må håndteres nå"
              description="Ordre til godkjenning og e-post som haster eller mangler ansvarlig."
              icon={AlertCircle}
              scope="preview/must-handle"
              groups={groups}
              emptyText="Ingenting haster akkurat nå."
            />
            <WorkQueueCard
              title="Neste leveringer"
              description="Ordre med levering 5. februar – 6. februar."
              icon={TruckIcon}
              scope="preview/next"
              hideGroupLabels
              groups={[{ ...groups[0], key: "next", label: "Neste", toLabel: "Vis alle" }]}
              emptyText="Ingen leveringer."
            />
            <AutomationRunsCard
              recurringDate="2026-02-06"
              onChangeRecurringDate={noop}
              dates={{ today: "2026-02-05", tomorrow: "2026-02-06", dayAfter: "2026-02-07" }}
              recurring={{
                rows: groups[0].rows,
                total: 11,
                to: "/x",
                isLoading: false,
                isError: false,
                error: null,
                refetch: noop,
              }}
              website={{ count: 2, to: "/x", isLoading: false, isError: false, error: null, refetch: noop }}
              deliveryNotes={{
                count: 34,
                mainRunDone: true,
                extraRuns: 2,
                to: "/x",
                isLoading: false,
                isError: false,
                error: null,
                refetch: noop,
              }}
            />
          </section>
          <section className="grid gap-6 xl:grid-cols-3">
            <WorkQueueCard
              title="Feiltilstand"
              description="Kontroll av avgrenset feilflate."
              icon={AlertCircle}
              scope="preview/error"
              groups={[]}
              isError
              error={new Error("boom")}
              onRetry={noop}
              emptyText="Tomt"
            />
          </section>
        </div>
      </TooltipProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
