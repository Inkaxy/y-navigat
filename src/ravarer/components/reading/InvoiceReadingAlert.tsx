import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/hooks/useCompany";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useInvoiceReadingHealth } from "@/ravarer/hooks/useInvoiceReadingHealth";
import { fmtOsloDateTime } from "@/ravarer/lib/invoiceReadingHealth";
import { paths } from "@/ravarer/lib/paths";

/** Varsel når fakturalesingen står stille fordi AI-tjenesten feiler. Vises ikke ved ok/ukjent. */
export function InvoiceReadingAlert({ enabled = true }: { enabled?: boolean }) {
  const { data: company } = useCompany();
  const { data: isAdmin = false } = usePlatformAdmin();
  const q = useInvoiceReadingHealth(company?.id ?? null, enabled);
  const h = q.data;
  if (!h || h.state !== "failing") return null;
  return (
    <Alert variant="destructive" role="alert" aria-live="polite">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>Fakturalesingen står stille</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{h.failure.message}</p>
        <p className="text-sm">
          Siste vellykkede lesing: {fmtOsloDateTime(h.lastSuccessAt)}.
          {h.failingSince ? ` Feilet siden ${fmtOsloDateTime(h.failingSince)}.` : ""}
          {h.waitingInvoices ? ` ${h.waitingInvoices.toLocaleString("nb-NO")} faktura(er) venter på lesing.` : ""}
          {" "}Nye fakturaer fra Tripletex leses ikke før dette er rettet.
        </p>
        {isAdmin ? (
          <Button asChild variant="outline" size="sm" className="min-h-[44px]">
            <Link to={paths.innstillinger({ seksjon: "ai" })}>Åpne AI-tjenester</Link>
          </Button>
        ) : (
          <p className="text-sm">Be en plattformadministrator om å legge inn ny nøkkel under AI-tjenester.</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
