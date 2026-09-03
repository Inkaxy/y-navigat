import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/errors/ErrorBoundary";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Hjem from "./pages/Hjem";

import NotFound from "./pages/NotFound";

import { AppAccessGuard } from "./components/auth/AppAccessGuard";
import { PlatformAdminGuard } from "./components/auth/PlatformAdminGuard";
import { Navigate } from "react-router-dom";
import { AppProvider as VarerAppProvider } from "@/varer/context/AppContext";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { SelectedEntityProvider as KunderEntityProviderRaw } from "@/kunder/state/SelectedEntityContext";
import { useUserAccess as useKunderUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth as useNbhubAuth } from "@/hooks/useAuth";

// POS Styring (importert fra POS Manager Hub)
import { AppColorProvider } from "@/providers/AppColorProvider";
import { LegalEntityProvider as PosStyringEntityProvider } from "@/pos_styring/contexts/LegalEntityContext";

// Kiosk-ruter — bypass NBhub-shell + auth-guard, egen Supabase-klient



// Ordre-app

import { RavarerProvider } from "@/ravarer/context/RavarerContext";

import { FakturaerProvider } from "@/fakturaer/context/FakturaerContext";
import { InvoiceAccessGuard } from "@/ravarer/components/InvoiceAccessGuard";

// Fakturering (utgående kundefakturaer → Tripletex)
import { FaktureringProvider } from "@/fakturering/context/FaktureringContext";



const KunderEntityProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useNbhubAuth();
  const { data: access } = useKunderUserAccess(user);
  return (
    <KunderEntityProviderRaw defaultEntityId={access?.primaryEntityId ?? null}>
      {children}
    </KunderEntityProviderRaw>
  );
};


// Kodesplitting: hver app-side lastes først når ruten treffes.
const AdminIndex = lazy(() => import("./pages/admin/AdminIndex"));
const Integrasjoner = lazy(() => import("./pages/admin/Integrasjoner"));
const IntegrasjonDetalj = lazy(() => import("./pages/admin/IntegrasjonDetalj"));
const TripletexIntegrasjon = lazy(() => import("./pages/admin/TripletexIntegrasjon"));
const Helsesenter = lazy(() => import("./pages/admin/Helsesenter"));
const Audit = lazy(() => import("./pages/admin/Audit"));
const Selskaper = lazy(() => import("./pages/admin/Selskaper"));
const Brukere = lazy(() => import("./pages/admin/Brukere"));
const BrukerDetalj = lazy(() => import("./pages/admin/BrukerDetalj"));
const Tilganger = lazy(() => import("./pages/admin/Tilganger"));
const Outlets = lazy(() => import("./pages/admin/Outlets"));
const Stillinger = lazy(() => import("./pages/admin/Stillinger"));
const StillingDetalj = lazy(() => import("./pages/admin/StillingDetalj"));
const Apper = lazy(() => import("./pages/admin/Apper"));
const MinProfil = lazy(() => import("./pages/MinProfil"));
const Varsler = lazy(() => import("./pages/Varsler"));
const Hjelp = lazy(() => import("./pages/Hjelp"));
const AppPlaceholder = lazy(() => import("./pages/apps/AppPlaceholder"));
const AcceptInvite = lazy(() => import("./pages/auth/AcceptInvite"));
const SetPortalPassword = lazy(() => import("./pages/auth/SetPortalPassword"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));

const KioskOperatorRoute = lazy(() => import("@/kiosk/routes").then((m) => ({ default: m.KioskOperatorRoute })));
const KioskCustomerRoute = lazy(() => import("@/kiosk/routes").then((m) => ({ default: m.KioskCustomerRoute })));
const KioskSelfServiceRoute = lazy(() => import("@/kiosk/routes").then((m) => ({ default: m.KioskSelfServiceRoute })));
const VarerProductList = lazy(() => import("@/varer/pages/ProductList"));
const VarerProductDetail = lazy(() => import("@/varer/pages/ProductDetail"));
const VarerPriceLists = lazy(() => import("@/varer/pages/PriceLists"));
const VarerPriceListDetail = lazy(() => import("@/varer/pages/PriceListDetail"));
const VarerSpecialPrices = lazy(() => import("@/varer/pages/SpecialPrices"));
const VarerProfitability = lazy(() => import("@/varer/pages/Profitability"));
const VarerProfitabilityDashboard = lazy(() => import("@/varer/pages/ProfitabilityDashboard"));
const VarerPriceRounds = lazy(() => import("@/varer/pages/PriceRounds"));
const VarerPriceRoundDetail = lazy(() => import("@/varer/pages/PriceRoundDetail"));
const VarerRecipes = lazy(() => import("@/varer/pages/Recipes"));
const VarerRecipesCleanup = lazy(() => import("@/varer/pages/RecipesCleanup"));
const VarerRecipeDetail = lazy(() => import("@/varer/pages/RecipeDetail"));
const VarerPlaceholder = lazy(() => import("@/varer/pages/PlaceholderPage"));
const VarerCakeBuilderList = lazy(() => import("@/varer/pages/cakebuilder/CakeBuilderList"));
const VarerCakeBuilderDetail = lazy(() => import("@/varer/pages/cakebuilder/CakeBuilderDetail"));
const VarerSettingsLayout = lazy(() => import("@/varer/pages/settings/SettingsLayout"));
const VarerSettingsGeneral = lazy(() => import("@/varer/pages/settings/SettingsGeneral"));
const VarerSettingsMainCategories = lazy(() => import("@/varer/pages/settings/SettingsMainCategories"));
const VarerSettingsSubCategories = lazy(() => import("@/varer/pages/settings/SettingsSubCategories"));
const VarerSettingsProductPages = lazy(() => import("@/varer/pages/settings/SettingsProductPages"));
const VarerSettingsSalesGroups = lazy(() => import("@/varer/pages/settings/SettingsSalesGroups"));
const VarerSettingsProductionGroups = lazy(() => import("@/varer/pages/settings/SettingsProductionGroups"));
const VarerSettingsAI = lazy(() => import("@/varer/pages/settings/SettingsAI"));
const VarerSettingsCalc = lazy(() => import("@/varer/pages/settings/SettingsCalc"));
const VarerCakeBuilderEmbed = lazy(() => import("@/varer/pages/embed/CakeBuilderEmbed"));
const KunderCustomerList = lazy(() => import("@/kunder/pages/CustomerList"));
const KunderCustomerDetail = lazy(() => import("@/kunder/pages/CustomerDetail"));
const KunderProfileList = lazy(() => import("@/kunder/pages/ProfileList"));
const KunderProfileDetail = lazy(() => import("@/kunder/pages/ProfileDetail"));
const KunderPickupLocations = lazy(() => import("@/kunder/pages/PickupLocations"));
const KunderInnstillinger = lazy(() => import("@/kunder/pages/Innstillinger"));
const KunderCustomerGroups = lazy(() => import("@/kunder/pages/CustomerGroups"));
const KunderCustomerHistory = lazy(() => import("@/kunder/pages/CustomerHistory"));
const KunderPortalUsers = lazy(() => import("@/kunder/pages/PortalUsers"));
const ProduksjonOversikt = lazy(() => import("@/produksjon/pages/OversiktPage"));
const ProduksjonLager = lazy(() => import("@/produksjon/pages/LagerPage"));
const ProduksjonEtiketter = lazy(() => import("@/produksjon/pages/EtiketterPage"));
const ProduksjonsplanPage = lazy(() => import("@/produksjon/pages/ProduksjonsplanPage"));
const ProduksjonsavdelingerPage = lazy(() => import("@/produksjon/pages/innstillinger/ProduksjonsavdelingerPage"));
const PakkeomraderPage = lazy(() => import("@/produksjon/pages/innstillinger/PakkeomraderPage"));
const UtskriftsprofilerPage = lazy(() => import("@/produksjon/pages/innstillinger/UtskriftsprofilerPage"));
const PosStyringDashboard = lazy(() => import("@/pos_styring/pages/Dashboard"));
const PosStyringUtsalg = lazy(() => import("@/pos_styring/pages/Utsalg"));
const PosStyringTerminaler = lazy(() => import("@/pos_styring/pages/Terminaler"));
const PosStyringOperatorer = lazy(() => import("@/pos_styring/pages/Operatorer"));
const PosStyringTastatur = lazy(() => import("@/pos_styring/pages/Tastatur"));
const PosStyringTastaturEditor = lazy(() => import("@/pos_styring/pages/TastaturEditor"));
const PosStyringPosKunder = lazy(() => import("@/pos_styring/pages/PosKunder"));
const PosStyringProdukter = lazy(() => import("@/pos_styring/pages/Produkter"));
const PosStyringSesjoner = lazy(() => import("@/pos_styring/pages/Sesjoner"));
const PosStyringSesjonDetalj = lazy(() => import("@/pos_styring/pages/SesjonDetalj"));
const PosStyringTransaksjoner = lazy(() => import("@/pos_styring/pages/Transaksjoner"));
const PosStyringTransaksjonDetalj = lazy(() => import("@/pos_styring/pages/TransaksjonDetalj"));
const PosStyringRapporter = lazy(() => import("@/pos_styring/pages/Rapporter"));
const PosStyringZDetalj = lazy(() => import("@/pos_styring/pages/ZDetalj"));
const PosStyringInnstillinger = lazy(() => import("@/pos_styring/pages/Innstillinger"));
const PosStyringSafT = lazy(() => import("@/pos_styring/pages/SafTExport"));
const PosStyringSkrivere = lazy(() => import("@/pos_styring/pages/Skrivere"));
const PosStyringStasjoner = lazy(() => import("@/pos_styring/pages/Stasjoner"));
const PosStyringKasseHelse = lazy(() => import("@/pos_styring/pages/KasseHelse"));
const OrdreDashboard = lazy(() => import("@/ordre/pages/Dashboard"));
const OrdreOrdersList = lazy(() => import("@/ordre/pages/OrdersList"));
const OrdreNewOrder = lazy(() => import("@/ordre/pages/NewOrder"));
const OrdreOrderDetail = lazy(() => import("@/ordre/pages/OrderDetail"));
const OrdreLeveringskalender = lazy(() => import("@/ordre/pages/Leveringskalender"));
const OrdreCustomerOrders = lazy(() => import("@/ordre/pages/CustomerOrders"));
const OrdreTours = lazy(() => import("@/ordre/pages/Tours"));
const OrdreDeliveryRules = lazy(() => import("@/ordre/pages/DeliveryRules"));
const OrdreWeeklyDeliveryPlan = lazy(() => import("@/ordre/pages/WeeklyDeliveryPlan"));
const OrdreRecurringOrders = lazy(() => import("@/ordre/pages/RecurringOrders"));
const OrdreDeliveryNoteDashboard = lazy(() => import("@/ordre/pages/DeliveryNoteDashboard"));
const OrdreDeliveryNotesList = lazy(() => import("@/ordre/pages/DeliveryNotesList"));
const OrdreDeliveryNoteDetail = lazy(() => import("@/ordre/pages/DeliveryNoteDetail"));
const OrdreDeliveryNoteCorrections = lazy(() => import("@/ordre/pages/DeliveryNoteCorrections"));
const OrdreDeliveryNoteSettings = lazy(() => import("@/ordre/pages/DeliveryNoteSettings"));
const OrdreCakeImagesDashboard = lazy(() => import("@/ordre/pages/CakeImagesDashboard"));
const OrdreCakeImagesList = lazy(() => import("@/ordre/pages/CakeImagesList"));
const OrdreCakeImageEditor = lazy(() => import("@/ordre/pages/CakeImageEditor"));
const OrdreCakeImagesPrint = lazy(() => import("@/ordre/pages/CakeImagesPrint"));
const OrdreInnstillinger = lazy(() => import("@/ordre/pages/Innstillinger"));
const M365Callback = lazy(() => import("@/ordre/pages/M365Callback"));
const OrdreTicketsList = lazy(() => import("@/ordre/pages/TicketsInbox"));
const OrdreTicketDetail = lazy(() => import("@/ordre/pages/TicketDetail"));
const OrdreAiForslag = lazy(() => import("@/ordre/pages/AiForslag"));
const OrdreTicketReports = lazy(() => import("@/ordre/pages/TicketReports"));
const OrdreRefundsQueue = lazy(() => import("@/ordre/pages/RefundsQueue"));
const OrdrePakkesystem = lazy(() => import("@/ordre/pages/Pakkesystem"));
const OrdreWebsiteOrders = lazy(() => import("@/ordre/pages/WebsiteOrders"));
const RavarerVareliste = lazy(() => import("@/ravarer/pages/Vareliste"));
const RavarerDeklarasjonsnavn = lazy(() => import("@/ravarer/pages/Deklarasjonsnavn"));
const RavarerDetail = lazy(() => import("@/ravarer/pages/RawMaterialDetail"));
const RavarerLager = lazy(() => import("@/ravarer/pages/Lager"));
const RavarerVaremottak = lazy(() => import("@/ravarer/pages/Varemottak"));
const RavarerVaretelling = lazy(() => import("@/ravarer/pages/Varetelling"));
const RavarerPakningsstorrelser = lazy(() => import("@/ravarer/pages/PackageSizes"));
const RavarerReberegnKostpriser = lazy(() => import("@/ravarer/pages/ReberegnKostpriser"));
const RavarerPakninger = lazy(() => import("@/ravarer/pages/Pakninger"));
const RavarerMatvaretabellen = lazy(() => import("@/ravarer/pages/Matvaretabellen"));

const FakturaerList = lazy(() => import("@/fakturaer/pages/FakturaerList"));
const FakturaerNew = lazy(() => import("@/fakturaer/pages/NewInvoice"));
const FakturaerImportEhf = lazy(() => import("@/fakturaer/pages/ImportEhf"));
const FakturaerImportPdf = lazy(() => import("@/fakturaer/pages/ImportPdf"));
const FakturaerDetail = lazy(() => import("@/fakturaer/pages/InvoiceDetail"));
const FakturaerReviewQueue = lazy(() => import("@/fakturaer/pages/ReviewQueue"));
const FakturaerImport = lazy(() => import("@/fakturaer/pages/ImportInvoice"));
const FakturaerRegistrerLinjer = lazy(() => import("@/fakturaer/pages/RegistrerLinjer"));
const TripletexSettings = lazy(() => import("@/ravarer/pages/innstillinger/TripletexSettings"));
const AiServicesSettings = lazy(() => import("@/ravarer/pages/innstillinger/AiServicesSettings"));
const MatchToleranserSettings = lazy(() => import("@/ravarer/pages/innstillinger/MatchToleranser"));
const KategorierSettings = lazy(() => import("@/ravarer/pages/innstillinger/KategorierSettings"));
const RavarerLeverandorer = lazy(() => import("@/ravarer/pages/Leverandorer"));
const RavarerLeverandorDetail = lazy(() => import("@/ravarer/pages/LeverandorDetail"));
const RavarerAvtaler = lazy(() => import("@/ravarer/pages/Avtaler"));
const RavarerDatabladEndringer = lazy(() => import("@/ravarer/pages/DatabladEndringer"));
const RavarerDatabladBulk = lazy(() => import("@/ravarer/pages/DatabladBulk"));
const RavarerForhandlingerList = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingerList"));
const RavarerForhandlingWizard = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingWizard"));
const RavarerForhandlingDetail = lazy(() => import("@/ravarer/pages/forhandlinger/ForhandlingDetail"));
const RavarerSupplierPortal = lazy(() => import("@/ravarer/pages/forhandlinger/SupplierPortal"));
const VarerPublicRecipe = lazy(() => import("@/varer/pages/PublicRecipe"));
const RavarerLiveForhandlingSetup = lazy(() => import("@/ravarer/pages/forhandlinger/LiveForhandlingSetup"));
const RavarerLiveForhandlingWorkspace = lazy(() => import("@/ravarer/pages/forhandlinger/LiveForhandlingWorkspace"));
const RavarerLiveConfirmationPortal = lazy(() => import("@/ravarer/pages/forhandlinger/LiveConfirmationPortal"));
const Fakturakjoring = lazy(() => import("@/fakturering/pages/Fakturakjoring"));
const Fakturasok = lazy(() => import("@/fakturering/pages/Fakturasok"));
const Kjoringer = lazy(() => import("@/fakturering/pages/Kjoringer"));
const KjoringDetalj = lazy(() => import("@/fakturering/pages/KjoringDetalj"));
const FakturaInnstillinger = lazy(() => import("@/fakturering/pages/FakturaInnstillinger"));

// Rapporter (fase R.0: skall + 8 undersider)
const RapporterDashbord = lazy(() => import("@/rapporter/pages/Dashbord"));
const RapporterStatistikk = lazy(() => import("@/rapporter/pages/Statistikk"));
const RapporterTrender = lazy(() => import("@/rapporter/pages/Trender"));
const RapporterKunder = lazy(() => import("@/rapporter/pages/Kunder"));
const RapporterSammenligning = lazy(() => import("@/rapporter/pages/Sammenligning"));
const RapporterNgEksport = lazy(() => import("@/rapporter/pages/NgEksport"));
const RapporterStatistikkgrupper = lazy(() => import("@/rapporter/pages/Statistikkgrupper"));
const RapporterHistorikk = lazy(() => import("@/rapporter/pages/Historikk"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RedirectFakturaer = () => {
  const { id } = useParams();
  return <Navigate to={`/ravarer/fakturaer/${id}`} replace />;
};

/**
 * `/tilbakestill-passord` deles av to flyter:
 * - Kundeportalen (kundeportal.nbhub.no) → eksisterende SetPortalPassword.
 * - Ansatte i NBHub → ResetPassword fra «Glemt passord».
 */
const TilbakestillPassordRoute = () => {
  const isPortalHost =
    typeof window !== "undefined" && window.location.hostname.startsWith("kundeportal.");
  return isPortalHost ? <SetPortalPassword /> : <ResetPassword />;
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

const FaktureringShell = ({ children }: { children: React.ReactNode }) => (
  <Shell>
    <AppAccessGuard appCode="faktura" appName="Fakturering">
      <AppColorProvider appCode="faktura">
        <FaktureringProvider>{children}</FaktureringProvider>
      </AppColorProvider>
    </AppAccessGuard>
  </Shell>
);

const RapporterShell = ({ children }: { children: React.ReactNode }) => (
  <Shell>
    <AppAccessGuard appCode="rapporter" appName="Rapporter">
      <AppColorProvider appCode="rapporter">{children}</AppColorProvider>
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
  <ErrorBoundary variant="app" scope="root">
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
            <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Laster …</div>}>
              <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/glemt-passord" element={<ForgotPassword />} />
              <Route path="/velg-passord" element={<SetPortalPassword />} />
              <Route path="/tilbakestill-passord" element={<TilbakestillPassordRoute />} />
              <Route path="/login/velg-passord" element={<SetPortalPassword />} />
              <Route path="/login/tilbakestill-passord" element={<SetPortalPassword />} />

              <Route path="/auth/accept-invite" element={<AcceptInvite />} />
              <Route path="/aktiver" element={<AcceptInvite />} />
              <Route path="/" element={<Index />} />
              <Route path="/hjem" element={<Navigate to="/" replace />} />
              <Route path="/mine-apper" element={<Navigate to="/" replace />} />
              <Route path="/min-profil" element={<Shell><MinProfil /></Shell>} />
              <Route path="/varsler" element={<Shell><Varsler /></Shell>} />
              <Route path="/hjelp" element={<Shell><Hjelp /></Shell>} />
              <Route path="/admin" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminIndex /></AppAccessGuard></Shell>} />
              <Route path="/admin/selskaper" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Selskaper"><Selskaper /></PlatformAdminGuard></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Brukere /></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere/:id" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Brukerdetaljer"><BrukerDetalj /></PlatformAdminGuard></AppAccessGuard></Shell>} />
              <Route path="/admin/tilganger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Tilganger"><Tilganger /></PlatformAdminGuard></AppAccessGuard></Shell>} />
              <Route path="/admin/outlets" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Outlets"><Outlets /></PlatformAdminGuard></AppAccessGuard></Shell>} />
              <Route path="/admin/stillinger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Stillinger"><Stillinger /></PlatformAdminGuard></AppAccessGuard></Shell>} />
              <Route path="/admin/stillinger/:id" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><PlatformAdminGuard title="Stillingsdetaljer"><StillingDetalj /></PlatformAdminGuard></AppAccessGuard></Shell>} />
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
              {/* Public delt oppskrift — no shell, no auth */}
              <Route path="/oppskrift/:token" element={<VarerPublicRecipe />} />


              {/* Varer sub-routes */}
              <Route path="/varer" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><Navigate to="/varer/vareliste" replace /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductList /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceLists /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceListDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/spesialpriser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerSpecialPrices /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/lonnsomhet" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProfitability /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/dashbord" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProfitabilityDashboard /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/prisrunder" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceRounds /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/prisrunder/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceRoundDetail /></VarerAppProvider></AppAccessGuard></Shell>} />


              <Route path="/varer/oppskrifter" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipes /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/oppskrifter/krever-opprydding" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipesCleanup /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/oppskrifter/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipeDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/kakebygger" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerCakeBuilderList /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/kakebygger/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerCakeBuilderDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/sortiment" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPlaceholder title="Sortiment" subtitle="Kanaler og kunder" body="Sortimentsstyring er ikke tilgjengelig ennå. Kanal- og kundesortiment styres inntil videre via prislister og spesialpriser." /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/avvik" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPlaceholder title="Avvik" subtitle="Avviksregistrering" body="Avviksregistrering for varer er ikke tilgjengelig. Meld avvik via ordre- eller produksjonsmodulen inntil videre." /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/innstillinger" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerSettingsLayout /></VarerAppProvider></AppAccessGuard></Shell>}>
                <Route index element={<Navigate to="/varer/innstillinger/hovedvaregrupper" replace />} />
                <Route path="generelt" element={<VarerSettingsGeneral />} />
                <Route path="hovedvaregrupper" element={<VarerSettingsMainCategories />} />
                <Route path="undervaregrupper" element={<VarerSettingsSubCategories />} />
                <Route path="varesider" element={<VarerSettingsProductPages />} />
                <Route path="salgsgrupper" element={<VarerSettingsSalesGroups />} />
                <Route path="produksjonsgrupper" element={<VarerSettingsProductionGroups />} />
                <Route path="kalkyle" element={<VarerSettingsCalc />} />
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
              <Route path="/ravarer/lager" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerLager /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/varemottak" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerVaremottak /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/varetelling" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerVaretelling /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/pakninger" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerPakninger /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/deklarasjonsnavn" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerDeklarasjonsnavn /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/matvaretabellen" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerMatvaretabellen /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/pakningsstorrelser" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerPakningsstorrelser /></RavarerProvider></AppAccessGuard></Shell>} />
              <Route path="/ravarer/fakturaer/reberegn-kostpriser" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerReberegnKostpriser /></RavarerProvider></AppAccessGuard></Shell>} />


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
              <Route path="/ravarer/leverandorer/:id" element={<Shell><AppAccessGuard appCode="ravarer" appName="Råvarer"><RavarerProvider><RavarerLeverandorDetail /></RavarerProvider></AppAccessGuard></Shell>} />
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
              <Route path="/ordre/leveranseplan" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreWeeklyDeliveryPlan /></AppAccessGuard></Shell>} />
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
              <Route path="/ordre/nettbutikk" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreWebsiteOrders /></AppAccessGuard></Shell>} />
              <Route path="/ordre/tilbakebetalinger" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreRefundsQueue /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ai-forslag" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreAiForslag /></AppAccessGuard></Shell>} />
              <Route path="/ordre/ticket-rapporter" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreTicketReports /></AppAccessGuard></Shell>} />
              <Route path="/ordre/pakkesystem" element={<Navigate to="/produksjon/pakkesystem" replace />} />
              <Route path="/ordre/innstillinger" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><OrdreInnstillinger /></AppAccessGuard></Shell>} />
              <Route path="/ordre/innstillinger/m365-callback" element={<Shell><AppAccessGuard appCode="ordre" appName="Ordre"><M365Callback /></AppAccessGuard></Shell>} />
              <Route path="/produksjon" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><Navigate to="/produksjon/oversikt" replace /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/oversikt" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonOversikt /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/produksjonsplan" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonsplanPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/pakkesystem" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><OrdrePakkesystem /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/lager" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonLager /></AppAccessGuard></Shell>} />
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
              <Route path="/pos-styring/innstillinger/saf-t" element={<PosStyringShell><PosStyringSafT /></PosStyringShell>} />
              <Route path="/pos-styring/skrivere" element={<PosStyringShell><PosStyringSkrivere /></PosStyringShell>} />
              <Route path="/pos-styring/stasjoner" element={<PosStyringShell><PosStyringStasjoner /></PosStyringShell>} />
              <Route path="/pos-styring/helse" element={<PosStyringShell><PosStyringKasseHelse /></PosStyringShell>} />

              {/* Fakturering (steg 1: skeletons — data-modell klar) */}
              <Route path="/fakturering" element={<FaktureringShell><Fakturakjoring /></FaktureringShell>} />
              <Route path="/fakturering/sok" element={<FaktureringShell><Fakturasok /></FaktureringShell>} />
              <Route path="/fakturering/kjoringer" element={<FaktureringShell><Kjoringer /></FaktureringShell>} />
              <Route path="/fakturering/kjoringer/:id" element={<FaktureringShell><KjoringDetalj /></FaktureringShell>} />
              <Route path="/fakturering/innstillinger" element={<FaktureringShell><FakturaInnstillinger /></FaktureringShell>} />

              {/* Rapporter (fase R.0: skall) */}
              <Route path="/rapporter" element={<Navigate to="/rapporter/dashbord" replace />} />
              <Route path="/rapporter/dashbord" element={<RapporterShell><RapporterDashbord /></RapporterShell>} />
              <Route path="/rapporter/statistikk" element={<RapporterShell><RapporterStatistikk /></RapporterShell>} />
              <Route path="/rapporter/trender" element={<RapporterShell><RapporterTrender /></RapporterShell>} />
              <Route path="/rapporter/kunder" element={<RapporterShell><RapporterKunder /></RapporterShell>} />
              <Route path="/rapporter/sammenligning" element={<RapporterShell><RapporterSammenligning /></RapporterShell>} />
              <Route path="/rapporter/ng-eksport" element={<RapporterShell><RapporterNgEksport /></RapporterShell>} />
              <Route path="/rapporter/statistikkgrupper" element={<RapporterShell><RapporterStatistikkgrupper /></RapporterShell>} />
              <Route path="/rapporter/historikk" element={<RapporterShell><RapporterHistorikk /></RapporterShell>} />





              {/* Kiosk-ruter — bypasser NBhub <Shell>/<ProtectedRoute>; egen Supabase-klient (storageKey 'pos-kiosk-auth') */}
              <Route path="/kiosk/o/:terminalId" element={<KioskOperatorRoute />} />
              <Route path="/kiosk/s/:terminalId" element={<KioskSelfServiceRoute />} />
              <Route path="/kiosk/k/:terminalId" element={<KioskCustomerRoute />} />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);


export default App;
