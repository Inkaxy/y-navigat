import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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

const queryClient = new QueryClient();

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
              <Route path="/kunder" element={<AppRoute code="kunder" name="Kunder" icon="Users" />} />
              <Route path="/ordre" element={<AppRoute code="ordre" name="Ordre" icon="ShoppingCart" />} />
              <Route path="/produksjon" element={<AppRoute code="produksjon" name="Produksjon" icon="Factory" />} />
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
