import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import Index from "./pages/Index";
import Login from "./pages/Login";
import AcceptInvite from "./pages/auth/AcceptInvite";
import Hjem from "./pages/Hjem";

import MinProfil from "./pages/MinProfil";
import Varsler from "./pages/Varsler";
import Hjelp from "./pages/Hjelp";
import NotFound from "./pages/NotFound";
import AppPlaceholder from "./pages/apps/AppPlaceholder";
import { AppAccessGuard } from "./components/auth/AppAccessGuard";
import AdminIndex from "./pages/admin/AdminIndex";
import AdminPlaceholder from "./pages/admin/AdminPlaceholder";
import Integrasjoner from "./pages/admin/Integrasjoner";
import IntegrasjonDetalj from "./pages/admin/IntegrasjonDetalj";
import TripletexIntegrasjon from "./pages/admin/TripletexIntegrasjon";
import Helsesenter from "./pages/admin/Helsesenter";
import Audit from "./pages/admin/Audit";
import Selskaper from "./pages/admin/Selskaper";
import Brukere from "./pages/admin/Brukere";
import BrukerDetalj from "./pages/admin/BrukerDetalj";
import Tilganger from "./pages/admin/Tilganger";
import Outlets from "./pages/admin/Outlets";
import Stillinger from "./pages/admin/Stillinger";
import StillingDetalj from "./pages/admin/StillingDetalj";
import Apper from "./pages/admin/Apper";
import { Navigate } from "react-router-dom";
import { AppProvider as VarerAppProvider } from "@/varer/context/AppContext";
import { SelectionProvider } from "@/providers/SelectionProvider";
import VarerProductList from "@/varer/pages/ProductList";
import VarerProductDetail from "@/varer/pages/ProductDetail";
import VarerPriceLists from "@/varer/pages/PriceLists";
import VarerPriceListDetail from "@/varer/pages/PriceListDetail";
import VarerSpecialPrices from "@/varer/pages/SpecialPrices";
import VarerRecipes from "@/varer/pages/Recipes";
import VarerRecipesCleanup from "@/varer/pages/RecipesCleanup";
import VarerPlaceholder from "@/varer/pages/PlaceholderPage";
import VarerCakeBuilderList from "@/varer/pages/cakebuilder/CakeBuilderList";
import VarerCakeBuilderDetail from "@/varer/pages/cakebuilder/CakeBuilderDetail";
import VarerSettingsLayout from "@/varer/pages/settings/SettingsLayout";
import VarerSettingsGeneral from "@/varer/pages/settings/SettingsGeneral";
import VarerSettingsMainCategories from "@/varer/pages/settings/SettingsMainCategories";
import VarerSettingsSubCategories from "@/varer/pages/settings/SettingsSubCategories";
import VarerSettingsProductPages from "@/varer/pages/settings/SettingsProductPages";
import VarerSettingsSalesGroups from "@/varer/pages/settings/SettingsSalesGroups";
import VarerSettingsProductionGroups from "@/varer/pages/settings/SettingsProductionGroups";
import VarerSettingsAI from "@/varer/pages/settings/SettingsAI";
import VarerCakeBuilderEmbed from "@/varer/pages/embed/CakeBuilderEmbed";
import { SelectedEntityProvider as KunderEntityProviderRaw } from "@/kunder/state/SelectedEntityContext";
import KunderCustomerList from "@/kunder/pages/CustomerList";
import KunderCustomerDetail from "@/kunder/pages/CustomerDetail";
import KunderProfileList from "@/kunder/pages/ProfileList";
import KunderProfileDetail from "@/kunder/pages/ProfileDetail";
import KunderPickupLocations from "@/kunder/pages/PickupLocations";
import KunderInnstillinger from "@/kunder/pages/Innstillinger";
import KunderCustomerGroups from "@/kunder/pages/CustomerGroups";
import KunderCustomerHistory from "@/kunder/pages/CustomerHistory";
import KunderPlaceholder from "@/kunder/pages/Placeholder";
import KunderPortalUsers from "@/kunder/pages/PortalUsers";
import { useUserAccess as useKunderUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth as useNbhubAuth } from "@/hooks/useAuth";
import ProduksjonOversikt from "@/produksjon/pages/OversiktPage";
import ProduksjonEtiketter from "@/produksjon/pages/EtiketterPage";
import ProduksjonsplanPage from "@/produksjon/pages/ProduksjonsplanPage";
import ProduksjonsavdelingerPage from "@/produksjon/pages/innstillinger/ProduksjonsavdelingerPage";
import PakkeomraderPage from "@/produksjon/pages/innstillinger/PakkeomraderPage";
import UtskriftsprofilerPage from "@/produksjon/pages/innstillinger/UtskriftsprofilerPage";

// POS Styring (importert fra POS Manager Hub)
import { AppColorProvider } from "@/providers/AppColorProvider";
import { LegalEntityProvider as PosStyringEntityProvider } from "@/pos_styring/contexts/LegalEntityContext";
import PosStyringDashboard from "@/pos_styring/pages/Dashboard";
import PosStyringUtsalg from "@/pos_styring/pages/Utsalg";
import PosStyringTerminaler from "@/pos_styring/pages/Terminaler";
import PosStyringOperatorer from "@/pos_styring/pages/Operatorer";
import PosStyringTastatur from "@/pos_styring/pages/Tastatur";
import PosStyringTastaturEditor from "@/pos_styring/pages/TastaturEditor";
import PosStyringPosKunder from "@/pos_styring/pages/PosKunder";
import PosStyringProdukter from "@/pos_styring/pages/Produkter";
import PosStyringSesjoner from "@/pos_styring/pages/Sesjoner";
import PosStyringSesjonDetalj from "@/pos_styring/pages/SesjonDetalj";
import PosStyringTransaksjoner from "@/pos_styring/pages/Transaksjoner";
import PosStyringTransaksjonDetalj from "@/pos_styring/pages/TransaksjonDetalj";
import PosStyringRapporter from "@/pos_styring/pages/Rapporter";
import PosStyringZDetalj from "@/pos_styring/pages/ZDetalj";
import PosStyringInnstillinger from "@/pos_styring/pages/Innstillinger";
import PosStyringSkrivere from "@/pos_styring/pages/Skrivere";
import PosStyringStasjoner from "@/pos_styring/pages/Stasjoner";

// Kiosk-ruter — bypass NBhub-shell + auth-guard, egen Supabase-klient
import { KioskOperatorRoute, KioskCustomerRoute, KioskSelfServiceRoute } from "@/kiosk/routes";



// Ordre-app
import OrdreDashboard from "@/ordre/pages/Dashboard";
import OrdreOrdersList from "@/ordre/pages/OrdersList";
import OrdreNewOrder from "@/ordre/pages/NewOrder";
import OrdreOrderDetail from "@/ordre/pages/OrderDetail";
import OrdreLeveringskalender from "@/ordre/pages/Leveringskalender";
import OrdreCustomerOrders from "@/ordre/pages/CustomerOrders";
import OrdreTours from "@/ordre/pages/Tours";
import OrdreDeliveryRules from "@/ordre/pages/DeliveryRules";
import OrdreRecurringOrders from "@/ordre/pages/RecurringOrders";
import OrdreDeliveryNoteDashboard from "@/ordre/pages/DeliveryNoteDashboard";
import OrdreDeliveryNotesList from "@/ordre/pages/DeliveryNotesList";
import OrdreDeliveryNoteDetail from "@/ordre/pages/DeliveryNoteDetail";
import OrdreDeliveryNoteCorrections from "@/ordre/pages/DeliveryNoteCorrections";
import OrdreDeliveryNoteSettings from "@/ordre/pages/DeliveryNoteSettings";
import OrdreCakeImagesDashboard from "@/ordre/pages/CakeImagesDashboard";
import OrdreCakeImagesList from "@/ordre/pages/CakeImagesList";
import OrdreCakeImageEditor from "@/ordre/pages/CakeImageEditor";
import OrdreCakeImagesPrint from "@/ordre/pages/CakeImagesPrint";
import OrdrePlaceholder from "@/ordre/pages/Placeholder";
import OrdreInnstillinger from "@/ordre/pages/Innstillinger";
import M365Callback from "@/ordre/pages/M365Callback";
import OrdrePortalTest from "@/ordre/pages/PortalTest";
import OrdreTicketsList from "@/ordre/pages/TicketsList";
import OrdreTicketDetail from "@/ordre/pages/TicketDetail";
import OrdreAiForslag from "@/ordre/pages/AiForslag";
import OrdreTicketReports from "@/ordre/pages/TicketReports";

import { RavarerProvider } from "@/ravarer/context/RavarerContext";
import RavarerVareliste from "@/ravarer/pages/Vareliste";
import RavarerDetail from "@/ravarer/pages/RawMaterialDetail";

import { FakturaerProvider } from "@/fakturaer/context/FakturaerContext";
import FakturaerList from "@/fakturaer/pages/FakturaerList";
import FakturaerNew from "@/fakturaer/pages/NewInvoice";
import FakturaerImportEhf from "@/fakturaer/pages/ImportEhf";
import FakturaerImportPdf from "@/fakturaer/pages/ImportPdf";
import FakturaerDetail from "@/fakturaer/pages/InvoiceDetail";
import FakturaerReviewQueue from "@/fakturaer/pages/ReviewQueue";
import FakturaerImport from "@/fakturaer/pages/ImportInvoice";
import FakturaerRegistrerLinjer from "@/fakturaer/pages/RegistrerLinjer";
import { InvoiceAccessGuard } from "@/ravarer/components/InvoiceAccessGuard";
import TripletexSettings from "@/ravarer/pages/innstillinger/TripletexSettings";
import AiServicesSettings from "@/ravarer/pages/innstillinger/AiServicesSettings";
import MatchToleranserSettings from "@/ravarer/pages/innstillinger/MatchToleranser";
import KategorierSettings from "@/ravarer/pages/innstillinger/KategorierSettings";
import RavarerLeverandorer from "@/ravarer/pages/Leverandorer";
import RavarerAvtaler from "@/ravarer/pages/Avtaler";
import RavarerDatabladEndringer from "@/ravarer/pages/DatabladEndringer";
import RavarerDatabladBulk from "@/ravarer/pages/DatabladBulk";
import RavarerForhandlingerList from "@/ravarer/pages/forhandlinger/ForhandlingerList";
import RavarerForhandlingWizard from "@/ravarer/pages/forhandlinger/ForhandlingWizard";
import RavarerForhandlingDetail from "@/ravarer/pages/forhandlinger/ForhandlingDetail";
import RavarerSupplierPortal from "@/ravarer/pages/forhandlinger/SupplierPortal";
import RavarerLiveForhandlingSetup from "@/ravarer/pages/forhandlinger/LiveForhandlingSetup";
import RavarerLiveForhandlingWorkspace from "@/ravarer/pages/forhandlinger/LiveForhandlingWorkspace";
import RavarerLiveConfirmationPortal from "@/ravarer/pages/forhandlinger/LiveConfirmationPortal";

const KunderEntityProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useNbhubAuth();
  const { data: access } = useKunderUserAccess(user);
  return (
    <KunderEntityProviderRaw defaultEntityId={access?.primaryEntityId ?? null}>
      {children}
    </KunderEntityProviderRaw>
  );
};

const queryClient = new QueryClient();

const RedirectFakturaer = () => {
  const { id } = useParams();
  return <Navigate to={`/ravarer/fakturaer/${id}`} replace />;
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppShell>{children}</AppShell>
  </ProtectedRoute>
);

const PosStyringShell = ({ children }: { children: React.ReactNode }) => (
  <Shell>
    <AppAccessGuard appCode="pos_styring" appName="POS Styring">
      <AppColorProvider appCode="pos_styring">
        <PosStyringEntityProvider>{children}</PosStyringEntityProvider>
      </AppColorProvider>
    </AppAccessGuard>
  </Shell>
);

const AppRoute = ({
  code,
  name,
  icon,
}: {
  code: string;
  name: string;
  icon: string;
}) => (
  <Shell>
    <AppAccessGuard appCode={code} appName={name}>
      <AppPlaceholder appCode={code} title={name} iconName={icon} />
    </AppAccessGuard>
  </Shell>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/accept-invite" element={<AcceptInvite />} />
              <Route path="/aktiver" element={<AcceptInvite />} />
              <Route path="/" element={<Index />} />
              <Route path="/hjem" element={<Navigate to="/" replace />} />
              <Route path="/mine-apper" element={<Navigate to="/" replace />} />
              <Route path="/min-profil" element={<Shell><MinProfil /></Shell>} />
              <Route path="/varsler" element={<Shell><Varsler /></Shell>} />
              <Route path="/hjelp" element={<Shell><Hjelp /></Shell>} />
              <Route path="/admin" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminIndex /></AppAccessGuard></Shell>} />
              <Route path="/admin/selskaper" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Selskaper /></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Brukere /></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere/:id" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><BrukerDetalj /></AppAccessGuard></Shell>} />
              <Route path="/admin/tilganger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Tilganger /></AppAccessGuard></Shell>} />
              <Route path="/admin/outlets" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Outlets /></AppAccessGuard></Shell>} />
              <Route path="/admin/stillinger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Stillinger /></AppAccessGuard></Shell>} />
              <Route path="/admin/stillinger/:id" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><StillingDetalj /></AppAccessGuard></Shell>} />
              <Route path="/admin/apper" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Apper /></AppAccessGuard></Shell>} />
              <Route path="/admin/integrasjoner" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Integrasjoner /></AppAccessGuard></Shell>} />
              <Route path="/admin/integrasjoner/tripletex" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><TripletexIntegrasjon /></AppAccessGuard></Shell>} />
              <Route path="/admin/integrasjoner/:integrationType" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><IntegrasjonDetalj /></AppAccessGuard></Shell>} />
              <Route path="/admin/helsesenter" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Helsesenter /></AppAccessGuard></Shell>} />
              <Route path="/admin/audit" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Audit /></AppAccessGuard></Shell>} />
              {/* Varer embed routes — frosset kontrakt, INGEN AppShell */}
              <Route path="/embed/v1/kakebygger/:categoryId" element={<SelectionProvider><VarerAppProvider><VarerCakeBuilderEmbed /></VarerAppProvider></SelectionProvider>} />
              <Route path="/embed/kakebygger/:categoryId" element={<SelectionProvider><VarerAppProvider><VarerCakeBuilderEmbed /></VarerAppProvider></SelectionProvider>} />
              {/* Public supplier RFQ portal — no shell, no auth */}
              <Route path="/tilbud/:token" element={<RavarerSupplierPortal />} />
              <Route path="/bekreftelse/:token" element={<RavarerLiveConfirmationPortal />} />

              {/* Varer sub-routes */}
              <Route path="/varer" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><Navigate to="/varer/vareliste" replace /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductList /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceLists /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceListDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/spesialpriser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerSpecialPrices /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/oppskrifter" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipes /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/oppskrifter/krever-opprydding" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipesCleanup /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/kakebygger" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerCakeBuilderList /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/kakebygger/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerCakeBuilderDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/sortiment" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPlaceholder title="Sortiment" subtitle="Kanaler og kunder" body="Sortimentsstyring kommer når Kunder-appen er bygget." /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/avvik" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPlaceholder title="Avvik" subtitle="Avviksregistrering" body="Avviksregistrering for varer kommer i fremtidig iterasjon." /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/innstillinger" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerSettingsLayout /></VarerAppProvider></AppAccessGuard></Shell>}>
                <Route index element={<Navigate to="/varer/innstillinger/hovedvaregrupper" replace />} />
                <Route path="generelt" element={<VarerSettingsGeneral />} />
                <Route path="hovedvaregrupper" element={<VarerSettingsMainCategories />} />
                <Route path="undervaregrupper" element={<VarerSettingsSubCategories />} />
                <Route path="varesider" element={<VarerSettingsProductPages />} />
                <Route path="salgsgrupper" element={<VarerSettingsSalesGroups />} />
                <Route path="produksjonsgrupper" element={<VarerSettingsProductionGroups />} />
                <Route path="ai" element={<VarerSettingsAI />} />
              </Route>
              {/* Kunder sub-routes */}
              <Route path="/kunder" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><Navigate to="/kunder/kundeliste" replace /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundeliste" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerList /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundeliste/:id" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerDetail /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/profiler" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderProfileList /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/profiler/:id" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderProfileDetail /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundegrupper" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerGroups /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/historikk" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerHistory /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/portaltilgang" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderPortalUsers /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/innstillinger" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderInnstillinger /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/innstillinger/hentesteder" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderPickupLocations /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><Navigate to="/ravarer/vareliste" replace /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/vareliste" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerVareliste /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/vareliste/:id" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerDetail /></RavarerProvider></AppAccessGuard></Shell>} />

              {/* Fakturaer flyttet inn under Råvarer-appen (granulær invoice_access) */}
              <Route path="/ravarer/fakturaer" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><FakturaerProvider><FakturaerList /></FakturaerProvider></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              {/* Samlet manuell import (EHF/PDF/manuelt) under én rute med tabs */}
              <Route path="/ravarer/fakturaer/import" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><FakturaerProvider><FakturaerImport /></FakturaerProvider></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              {/* Bakoverkompat — peker mot tab-versjonen */}
              <Route path="/ravarer/fakturaer/ny" element={<Navigate to="/ravarer/fakturaer/import?tab=manuelt" replace />} />
              <Route path="/ravarer/fakturaer/import-ehf" element={<Navigate to="/ravarer/fakturaer/import?tab=ehf" replace />} />
              <Route path="/ravarer/fakturaer/import-pdf" element={<Navigate to="/ravarer/fakturaer/import?tab=pdf" replace />} />
              <Route path="/ravarer/fakturaer/til-behandling" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><FakturaerProvider><FakturaerReviewQueue /></FakturaerProvider></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/fakturaer/:id/registrer-linjer" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><FakturaerProvider><FakturaerRegistrerLinjer /></FakturaerProvider></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/fakturaer/:id" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><FakturaerProvider><FakturaerDetail /></FakturaerProvider></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/innstillinger" element={<Navigate to="/ravarer/innstillinger/tripletex" replace />} />
              <Route path="/ravarer/leverandorer" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerLeverandorer /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/avtaler" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerAvtaler /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/datablad-endringer" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerDatabladEndringer /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/datablad-bulk" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerDatabladBulk /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerForhandlingerList /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger/ny" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerForhandlingWizard /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger/live/ny" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerLiveForhandlingSetup /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger/live/:id" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerLiveForhandlingWorkspace /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger/:id/rediger" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerForhandlingWizard /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/forhandlinger/:id" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><InvoiceAccessGuard><RavarerForhandlingDetail /></InvoiceAccessGuard></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/innstillinger/tripletex" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><TripletexSettings /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/innstillinger/ai-tjenester" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><AiServicesSettings /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/innstillinger/match-toleranser" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><MatchToleranserSettings /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/innstillinger/kategorier" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><KategorierSettings /></RavarerProvider></AppAccessGuard></Shell>} />

              {/* Backward-compat redirects fra gamle /fakturaer/* */}
              <Route path="/fakturaer" element={<Navigate to="/ravarer/fakturaer" replace />} />
              <Route path="/fakturaer/ny" element={<Navigate to="/ravarer/fakturaer/import?tab=manuelt" replace />} />
              <Route path="/fakturaer/import-ehf" element={<Navigate to="/ravarer/fakturaer/import?tab=ehf" replace />} />
              <Route path="/fakturaer/import-pdf" element={<Navigate to="/ravarer/fakturaer/import?tab=pdf" replace />} />
              <Route path="/fakturaer/til-behandling" element={<Navigate to="/ravarer/fakturaer/til-behandling" replace />} />
              <Route path="/fakturaer/:id" element={<RedirectFakturaer />} />

              <Route path="/ordre" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><Navigate to="/ordre/dashbord" replace /></AppAccessGuard></Shell>} />
              <Route path="/ordre/dashbord" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDashboard /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ordrer" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreOrdersList /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ordrer/ny" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreNewOrder /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ordrer/:id" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreOrderDetail /></AppAccessGuard></Shell>} />
              <Route path="/ordre/matrise" element={<Navigate to="/ordre/leveringskalender" replace />} />
              <Route path="/ordre/kundeordrer" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreCustomerOrders /></AppAccessGuard></Shell>} />
              <Route path="/ordre/turer" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreTours /></AppAccessGuard></Shell>} />
              <Route path="/ordre/leveringsregler" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryRules /></AppAccessGuard></Shell>} />
              <Route path="/ordre/faste-rutiner" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreRecurringOrders /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakksedler" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryNoteDashboard /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakksedler/liste" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryNotesList /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakksedler/korrigeringer" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryNoteCorrections /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakksedler/innstillinger" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryNoteSettings /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakksedler/:id" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreDeliveryNoteDetail /></AppAccessGuard></Shell>} />
              <Route path="/ordre/kakebilder" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreCakeImagesDashboard /></AppAccessGuard></Shell>} />
              <Route path="/ordre/kakebilder/liste" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreCakeImagesList /></AppAccessGuard></Shell>} />
              <Route path="/ordre/kakebilder/editor/:id" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreCakeImageEditor /></AppAccessGuard></Shell>} />
              <Route path="/ordre/kakebilder/print" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreCakeImagesPrint /></AppAccessGuard></Shell>} />
              <Route path="/ordre/leveringskalender" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreLeveringskalender /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ticket" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreTicketsList /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ticket/:id" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreTicketDetail /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ai-forslag" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreAiForslag /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ticket-rapporter" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreTicketReports /></AppAccessGuard></Shell>} />
              <Route path="/ordre/avvik" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdrePlaceholder title="Avvik" subtitle="Kommer i en senere fase" /></AppAccessGuard></Shell>} />
              <Route path="/ordre/innstillinger" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreInnstillinger /></AppAccessGuard></Shell>} />
              <Route path="/ordre/innstillinger/m365-callback" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><M365Callback /></AppAccessGuard></Shell>} />
              <Route path="/ordre/portal-test" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdrePortalTest /></AppAccessGuard></Shell>} />
              <Route path="/produksjon" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><Navigate to="/produksjon/oversikt" replace /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/oversikt" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonOversikt /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/produksjonsplan" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonsplanPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/etiketter" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonEtiketter /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/produksjonsavdelinger" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonsavdelingerPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/pakkeomrader" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><PakkeomraderPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/utskriftsprofiler" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><UtskriftsprofilerPage /></AppAccessGuard></Shell>} />

              {/* POS Styring — importert fra POS Manager Hub */}
              <Route path="/pos-styring" element={<PosStyringShell><PosStyringDashboard /></PosStyringShell>} />
              <Route path="/pos-styring/oversikt" element={<Navigate to="/pos-styring" replace />} />

              <Route path="/pos-styring/utsalg" element={<PosStyringShell><PosStyringUtsalg /></PosStyringShell>} />
              <Route path="/pos-styring/terminaler" element={<PosStyringShell><PosStyringTerminaler /></PosStyringShell>} />
              <Route path="/pos-styring/operatorer" element={<PosStyringShell><PosStyringOperatorer /></PosStyringShell>} />
              <Route path="/pos-styring/tastatur" element={<PosStyringShell><PosStyringTastatur /></PosStyringShell>} />
              <Route path="/pos-styring/tastatur/:id" element={<PosStyringShell><PosStyringTastaturEditor /></PosStyringShell>} />
              <Route path="/pos-styring/pos-kunder" element={<PosStyringShell><PosStyringPosKunder /></PosStyringShell>} />
              <Route path="/pos-styring/produkter" element={<PosStyringShell><PosStyringProdukter /></PosStyringShell>} />
              <Route path="/pos-styring/sesjoner" element={<PosStyringShell><PosStyringSesjoner /></PosStyringShell>} />
              <Route path="/pos-styring/sesjoner/:id" element={<PosStyringShell><PosStyringSesjonDetalj /></PosStyringShell>} />
              <Route path="/pos-styring/transaksjoner" element={<PosStyringShell><PosStyringTransaksjoner /></PosStyringShell>} />
              <Route path="/pos-styring/transaksjoner/:id" element={<PosStyringShell><PosStyringTransaksjonDetalj /></PosStyringShell>} />
              <Route path="/pos-styring/rapporter" element={<PosStyringShell><PosStyringRapporter /></PosStyringShell>} />
              <Route path="/pos-styring/rapporter/z/:id" element={<PosStyringShell><PosStyringZDetalj /></PosStyringShell>} />
              <Route path="/pos-styring/innstillinger" element={<PosStyringShell><PosStyringInnstillinger /></PosStyringShell>} />
              <Route path="/pos-styring/skrivere" element={<PosStyringShell><PosStyringSkrivere /></PosStyringShell>} />
              <Route path="/pos-styring/stasjoner" element={<PosStyringShell><PosStyringStasjoner /></PosStyringShell>} />

              {/* Kiosk-ruter — bypasser NBhub <Shell>/<ProtectedRoute>; egen Supabase-klient (storageKey 'pos-kiosk-auth') */}
              <Route path="/kiosk/o/:terminalId" element={<KioskOperatorRoute />} />
              <Route path="/kiosk/s/:terminalId" element={<KioskSelfServiceRoute />} />
              <Route path="/kiosk/k/:terminalId" element={<KioskCustomerRoute />} />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
