import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModuleScope } from "@/providers/ModuleScope";
import { VtApiContext } from "@/ravarer/varetelling/api";
import { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import { createFakeStage3, Stage3Context } from "@/ravarer/varetelling/stage3";
import { VtScopeContext } from "@/ravarer/varetelling/hooks";
import { VaretellingWorkspace } from "@/ravarer/varetelling/components/VaretellingWorkspace";

/**
 * SKRIVEBESKYTTET FORHÅNDSVISNING — syntetiske data i minnet, ingen Supabase, ingen nettverk.
 * Faktiske varetellingskomponenter for 390/768/1440-kontroll. `?utilgjengelig=1` viser «ikke tatt i bruk».
 */
export default function VaretellingPreviewContent() {
  const unavailable = new URLSearchParams(window.location.search).get("utilgjengelig") === "1";
  const [api] = useState(() => createFakeVtApi({ available: !unavailable }));
  // E-post er IKKE konfigurert i demonstrasjonen: skjermen viser sannferdig at ingenting kan sendes.
  const [s3] = useState(() => createFakeStage3(api, { available: !unavailable, mailConfigured: false }));
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <ModuleScope appCode="ravarer">
      <QueryClientProvider client={qc}>
        <VtApiContext.Provider value={api}>
          <Stage3Context.Provider value={s3}>
          <VtScopeContext.Provider value={{ entity: "demo-firma", userId: "demo-bruker", canWrite: true, canApprove: true }}>
            <main className="mx-auto max-w-5xl space-y-4 p-4">
              <p role="note" className="rounded-md border p-3 text-sm font-medium">Demonstrasjon – syntetiske data. Ingenting lagres.</p>
              <h1 className="text-2xl font-semibold">Varetelling</h1>
              <VaretellingWorkspace legacy={<p className="text-sm text-muted-foreground">Dagstellingen vises ikke i demonstrasjonen.</p>} />
            </main>
          </VtScopeContext.Provider>
          </Stage3Context.Provider>
        </VtApiContext.Provider>
      </QueryClientProvider>
    </ModuleScope>
  );
}
