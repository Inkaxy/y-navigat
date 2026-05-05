import Hjem from "./Hjem";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

export default function Index() {
  return (
    <ProtectedRoute>
      <AppShell>
        <Hjem />
      </AppShell>
    </ProtectedRoute>
  );
}
