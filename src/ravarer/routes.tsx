import { lazy, type ComponentType, type ReactNode } from "react";
import { Route, useSearchParams } from "react-router-dom";
import { AppAccessGuard } from "@/components/auth/AppAccessGuard";
import { RavarerProvider } from "@/ravarer/context/RavarerContext";
import { FakturaerProvider } from "@/fakturaer/context/FakturaerContext";
import { InvoiceAccessGuard } from "@/ravarer/components/InvoiceAccessGuard";
import { LegacyRavarerRedirect } from "@/ravarer/components/LegacyRavarerRedirect";
import { LEGACY_RAVARER_PATHS } from "@/ravarer/lib/legacyRoutes";
import { VarerShell } from "@/ravarer/pages/hub/VarerShell";

const Oversikt = lazy(() => import("@/ravarer/pages/hub/RavarerOversikt"));
const Priskontroll = lazy(() => import("@/ravarer/pages/hub/PriskontrollPage"));
const LeverandorerHub = lazy(() => import("@/ravarer/pages/hub/LeverandorerHub"));
const LagerHub = lazy(() => import("@/ravarer/pages/hub/LagerHub"));
const Innstillinger = lazy(() => import("@/ravarer/pages/hub/RavarerInnstillinger"));

const Vareliste = lazy(() => import("@/ravarer/pages/Vareliste"));
const RawMaterialDetail = lazy(() => import("@/ravarer/pages/RawMaterialDetail"));
const PackageSizes = lazy(() => import("@/ravarer/pages/PackageSizes"));
const Deklarasjonsnavn = lazy(() => import("@/ravarer/pages/Deklarasjonsnavn"));
const KobleMatvaretabellen = lazy(() => import("@/ravarer/pages/KobleMatvaretabellen"));
const DatabladEndringer = lazy(() => import("@/ravarer/pages/DatabladEndringer"));
const Matvaretabellen = lazy(() => import("@/ravarer/pages/Matvaretabellen"));
const DatabladBulk = lazy(() => import("@/ravarer/pages/DatabladBulk"));

const InvoiceDetail = lazy(() => import("@/fakturaer/pages/InvoiceDetail"));
const RegistrerLinjer = lazy(() => import("@/fakturaer/pages/RegistrerLinjer"));
const SupplierCase = lazy(() => import("@/fakturaer/pages/SupplierCase"));
const ImportInvoice = lazy(() => import("@/fakturaer/pages/ImportInvoice"));
const RavarerQueue = lazy(() => import("@/fakturaer/pages/RavarerQueue"));
const DecisionDetail = lazy(() => import("@/fakturaer/pages/DecisionDetail"));
const ReberegnKostpriser = lazy(() => import("@/ravarer/pages/ReberegnKostpriser"));

const LeverandorDetail = lazy(() => import("@/ravarer/pages/LeverandorDetail"));
const ForhandlingWizard = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingWizard"));
const ForhandlingDetail = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingDetail"));
const LiveSetup = lazy(() => import("@/ravarer/pages/forhandlinger/LiveForhandlingSetup"));
const LiveWorkspace = lazy(() => import("@/ravarer/pages/forhandlinger/LiveForhandlingWorkspace"));

type ShellType = ComponentType<{ children: ReactNode }>;

/**
 * Alle Råvarer-ruter (Råvarer 2.0). Statiske stier er deklarert før dynamiske,
 * og alle gamle stier sendes videre via `LegacyRavarerRedirect`.
 */
export function ravarerRoutes(Shell: ShellType) {
  const rv = (el: ReactNode) => (
    <Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider>{el}</RavarerProvider></AppAccessGuard></Shell>
  );
  const inv = (el: ReactNode) => rv(<InvoiceAccessGuard><FakturaerProvider>{el}</FakturaerProvider></InvoiceAccessGuard>);
  const invOnly = (el: ReactNode) => rv(<InvoiceAccessGuard>{el}</InvoiceAccessGuard>);

  return [
    <Route key="oversikt" path="/ravarer" element={rv(<Oversikt />)} />,

    // Varer
    <Route key="varer" path="/ravarer/varer" element={rv(<VarerShell active="alle"><Vareliste /></VarerShell>)} />,
    <Route key="pakninger" path="/ravarer/varer/pakninger" element={rv(<VarerShell active="pakninger"><PackageSizes /></VarerShell>)} />,
    <Route key="dekl" path="/ravarer/varer/deklarasjonsnavn" element={rv(<VarerShell active="deklarasjonsnavn"><Deklarasjonsnavn /></VarerShell>)} />,
    <Route key="naering" path="/ravarer/varer/naering" element={rv(<VarerShell active="naering"><KobleMatvaretabellen /></VarerShell>)} />,
    <Route key="datablad" path="/ravarer/varer/datablad-endringer" element={rv(<VarerShell active="datablad"><DatabladEndringer /></VarerShell>)} />,
    <Route key="mvt" path="/ravarer/varer/matvaretabellen" element={rv(<VarerShell title="Matvaretabellen"><Matvaretabellen /></VarerShell>)} />,
    <Route key="dbbulk" path="/ravarer/varer/datablad-opplasting" element={rv(<VarerShell title="Last opp datablad"><DatabladBulk /></VarerShell>)} />,
    <Route key="raavare" path="/ravarer/varer/:id" element={rv(<RawMaterialDetail />)} />,

    // Priskontroll
    <Route key="pk" path="/ravarer/priskontroll" element={inv(<Priskontroll />)} />,
    <Route key="pk-import" path="/ravarer/priskontroll/import" element={inv(<ImportInvoice />)} />,
    <Route key="pk-besl" path="/ravarer/priskontroll/beslutninger" element={inv(<QueueByScope />)} />,
    <Route key="pk-besl-d" path="/ravarer/priskontroll/beslutninger/:key" element={inv(<DecisionDetail />)} />,
    <Route key="pk-reb" path="/ravarer/priskontroll/verktoy/reberegn" element={rv(<InvoiceAccessGuard><ReberegnKostpriser /></InvoiceAccessGuard>)} />,
    <Route key="pk-sak" path="/ravarer/priskontroll/saker/:id" element={inv(<SupplierCase />)} />,
    <Route key="pk-reg" path="/ravarer/priskontroll/faktura/:id/registrer-linjer" element={inv(<RegistrerLinjer />)} />,
    <Route key="pk-fak" path="/ravarer/priskontroll/faktura/:id" element={inv(<InvoiceDetail />)} />,

    // Leverandører (statiske stier før /:id)
    <Route key="lev" path="/ravarer/leverandorer" element={rv(<LeverandorerHub />)} />,
    <Route key="f-ny" path="/ravarer/leverandorer/forhandlinger/ny" element={invOnly(<ForhandlingWizard />)} />,
    <Route key="f-live-ny" path="/ravarer/leverandorer/forhandlinger/live/ny" element={invOnly(<LiveSetup />)} />,
    <Route key="f-live" path="/ravarer/leverandorer/forhandlinger/live/:id" element={invOnly(<LiveWorkspace />)} />,
    <Route key="f-red" path="/ravarer/leverandorer/forhandlinger/:id/rediger" element={invOnly(<ForhandlingWizard />)} />,
    <Route key="f-det" path="/ravarer/leverandorer/forhandlinger/:id" element={invOnly(<ForhandlingDetail />)} />,
    <Route key="lev-d" path="/ravarer/leverandorer/:id" element={rv(<LeverandorDetail />)} />,

    // Lager og innstillinger
    <Route key="lager" path="/ravarer/lager" element={rv(<LagerHub />)} />,
    <Route key="innst" path="/ravarer/innstillinger" element={rv(<Innstillinger />)} />,

    // Gamle stier
    ...LEGACY_RAVARER_PATHS.map((p) => <Route key={`legacy:${p}`} path={p} element={<LegacyRavarerRedirect />} />),
  ];
}

function QueueByScope() {
  const [sp] = useSearchParams();
  return <RavarerQueue scope={sp.get("omfang") === "ravarer" ? "ravarer" : "alle"} />;
}
