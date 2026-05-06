import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useInvoiceAccess } from "@/ravarer/hooks/useInvoiceAccess";
import { Card } from "@/components/ui/card";

/**
 * Guarder fakturaer-rutene under /ravarer/fakturaer.
 * Krever invoice_access flag på Råvarer-appen for innlogget bruker.
 */
export function InvoiceAccessGuard({ children }: { children: ReactNode }) {
  const { data, isLoading } = useInvoiceAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-ink-secondary">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sjekker tilgang…
      </div>
    );
  }
  if (!data) {
    return (
      <Card className="m-6 p-8 text-center">
        <h2 className="mb-2 text-lg font-semibold">Ingen tilgang til Fakturaer</h2>
        <p className="text-sm text-ink-secondary">
          Du trenger fakturaer-tilgang på Råvarer-appen for å se denne siden. Kontakt
          plattform-ansvarlig.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}
