// Varsel (banner) når lesingen har stått stille i minst ett døgn med fakturaer i kø, eller når mange lesinger feiler.
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useReadingDrift } from "@/ravarer/hooks/useReadingDrift";
import { fmtOsloDateTime } from "@/ravarer/lib/invoiceReadingHealth";
import { FAIL_RATE_PCT } from "@/ravarer/lib/drift/readingStall";
import { paths } from "@/ravarer/lib/paths";

export function ReadingStallAlert({ enabled = true }: { enabled?: boolean }) {
  const q = useReadingDrift(enabled);
  const d = q.data;
  if (!d || (d.stall.kind !== "stillstand" && d.stall.kind !== "feilrate")) return null;
  const title = d.stall.kind === "stillstand" ? "Fakturalesingen har stått stille i over et døgn" : "Mange fakturaer feiler i lesingen";
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-1 text-sm">
        {d.stall.kind === "stillstand"
          ? <p>Siste ferdige lesing: {fmtOsloDateTime(d.lastOkAt)}. {d.pending?.toLocaleString("nb-NO")} faktura(er) venter i lesekøen.</p>
          : <p>{d.stall.pct.toLocaleString("nb-NO")} % av lesingene siste døgn feilet (grense {FAIL_RATE_PCT} %).</p>}
        <p><Link to={paths.innstillinger({ seksjon: "fakturalesing" })} className="font-semibold underline">Se helsesiden</Link></p>
      </AlertDescription>
    </Alert>
  );
}
