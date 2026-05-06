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
import Hjem from "./pages/Hjem";

import MinProfil from "./pages/MinProfil";
import Varsler from "./pages/Varsler";
import Hjelp from "./pages/Hjelp";
import NotFound from "./pages/NotFound";
import AppPlaceholder from "./pages/apps/AppPlaceholder";
import { AppAccessGuard } from "./components/auth/AppAccessGuard";
import AdminIndex from "./pages/admin/AdminIndex";
import AdminPlaceholder from "./pages/admin/AdminPlaceholder";
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
import VarerProductList from "@/varer/pages/ProductList";
import VarerProductDetail from "@/varer/pages/ProductDetail";
import VarerPriceLists from "@/varer/pages/PriceLists";
import VarerPriceListDetail from "@/varer/pages/PriceListDetail";
import VarerSpecialPrices from "@/varer/pages/SpecialPrices";
import VarerRecipes from "@/varer/pages/Recipes";
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
import VarerCakeBuilderEmbed from "@/varer/pages/embed/CakeBuilderEmbed";
import { SelectedEntityProvider as KunderEntityProviderRaw } from "@/kunder/state/SelectedEntityContext";
import KunderCustomerList from "@/kunder/pages/CustomerList";
import KunderCustomerDetail from "@/kunder/pages/CustomerDetail";
import KunderProfileList from "@/kunder/pages/ProfileList";
import KunderProfileDetail from "@/kunder/pages/ProfileDetail";
import KunderPickupLocations from "@/kunder/pages/PickupLocations";
import KunderPlaceholder from "@/kunder/pages/Placeholder";
import { useUserAccess as useKunderUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth as useNbhubAuth } from "@/hooks/useAuth";
import ProduksjonOversikt from "@/produksjon/pages/OversiktPage";
import ProduksjonEtiketter from "@/produksjon/pages/EtiketterPage";
import ProduksjonsavdelingerPage from "@/produksjon/pages/innstillinger/ProduksjonsavdelingerPage";
import PakkeomraderPage from "@/produksjon/pages/innstillinger/PakkeomraderPage";
import UtskriftsprofilerPage from "@/produksjon/pages/innstillinger/UtskriftsprofilerPage";

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
              <Route path="/admin/integrasjoner" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Integrasjoner" phase="1C" /></AppAccessGuard></Shell>} />
              <Route path="/admin/helsesenter" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Helsesenter" phase="1C" /></AppAccessGuard></Shell>} />
              <Route path="/admin/audit" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Audit" phase="1C" /></AppAccessGuard></Shell>} />
              {/* Varer embed routes — frosset kontrakt, INGEN AppShell */}
              <Route path="/embed/v1/kakebygger/:categoryId" element={<VarerAppProvider><VarerCakeBuilderEmbed /></VarerAppProvider>} />
              <Route path="/embed/kakebygger/:categoryId" element={<VarerAppProvider><VarerCakeBuilderEmbed /></VarerAppProvider>} />

              {/* Varer sub-routes */}
              <Route path="/varer" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><Navigate to="/varer/vareliste" replace /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductList /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/vareliste/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerProductDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceLists /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/priser/:id" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerPriceListDetail /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/spesialpriser" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerSpecialPrices /></VarerAppProvider></AppAccessGuard></Shell>} />
              <Route path="/varer/oppskrifter" element={<Shell><AppAccessGuard appCode="varer" appName="Varer"><VarerAppProvider><VarerRecipes /></VarerAppProvider></AppAccessGuard></Shell>} />
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
              </Route>
              {/* Kunder sub-routes */}
              <Route path="/kunder" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><Navigate to="/kunder/kundeliste" replace /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundeliste" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerList /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundeliste/:id" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderCustomerDetail /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/profiler" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderProfileList /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/profiler/:id" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderProfileDetail /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/kundegrupper" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderPlaceholder title="Kundegrupper" description="Segmenter for prising og rapportering" /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/historikk" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderPlaceholder title="Historikk" description="Endringslogg, ordrer og fakturaer" /></KunderEntityProvider></AppAccessGuard></Shell>} />
              <Route path="/kunder/innstillinger" element={<Shell><AppAccessGuard appCode="kunder" appName="Kunder"><KunderEntityProvider><KunderPlaceholder title="Innstillinger" description="App-spesifikke innstillinger" /></KunderEntityProvider></AppAccessGuard></Shell>} />
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

              <Route path="/ordre" element={<AppRoute code="ordre" name="Ordre" icon="ShoppingCart" />} />
              <Route path="/produksjon" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><Navigate to="/produksjon/oversikt" replace /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/oversikt" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonOversikt /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/etiketter" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonEtiketter /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/produksjonsavdelinger" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><ProduksjonsavdelingerPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/pakkeomrader" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><PakkeomraderPage /></AppAccessGuard></Shell>} />
              <Route path="/produksjon/innstillinger/utskriftsprofiler" element={<Shell><AppAccessGuard appCode="produksjon" appName="Produksjon"><UtskriftsprofilerPage /></AppAccessGuard></Shell>} />
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
