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
import MineApper from "./pages/MineApper";
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
              <Route path="/hjem" element={<Shell><Hjem /></Shell>} />
              <Route path="/mine-apper" element={<Shell><MineApper /></Shell>} />
              <Route path="/min-profil" element={<Shell><MinProfil /></Shell>} />
              <Route path="/varsler" element={<Shell><Varsler /></Shell>} />
              <Route path="/hjelp" element={<Shell><Hjelp /></Shell>} />
              <Route path="/admin" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminIndex /></AppAccessGuard></Shell>} />
              <Route path="/admin/selskaper" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Selskaper /></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Brukere /></AppAccessGuard></Shell>} />
              <Route path="/admin/brukere/:id" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><BrukerDetalj /></AppAccessGuard></Shell>} />
              <Route path="/admin/tilganger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><Tilganger /></AppAccessGuard></Shell>} />
              <Route path="/admin/outlets" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Outlets" phase="1B" /></AppAccessGuard></Shell>} />
              <Route path="/admin/stillinger" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Stillinger" phase="1B" /></AppAccessGuard></Shell>} />
              <Route path="/admin/apper" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Apper" phase="1B" /></AppAccessGuard></Shell>} />
              <Route path="/admin/integrasjoner" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Integrasjoner" phase="1C" /></AppAccessGuard></Shell>} />
              <Route path="/admin/helsesenter" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Helsesenter" phase="1C" /></AppAccessGuard></Shell>} />
              <Route path="/admin/audit" element={<Shell><AppAccessGuard appCode="nbos" appName="NBOS Admin"><AdminPlaceholder title="Audit" phase="1C" /></AppAccessGuard></Shell>} />
              <Route path="/varer" element={<AppRoute code="varer" name="Varer" icon="Package" />} />
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
