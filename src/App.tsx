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

const queryClient = new QueryClient();

const Shell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppShell>{children}</AppShell>
  </ProtectedRoute>
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
