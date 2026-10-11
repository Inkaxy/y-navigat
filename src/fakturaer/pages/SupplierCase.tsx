import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";
import { SupplierCaseDetail } from "@/ravarer/pages/priskontroll/saker/SupplierCaseDetail";

/** Leverandørsak som egen side (smal skjerm og dyplenker). Samme innhold som panelet. */
export default function SupplierCase() {
  const { id = "" } = useParams();
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-page py-6">
      <Link to={paths.saker()} className="inline-flex items-center gap-1 text-caption text-ink-secondary hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Leverandørsaker
      </Link>
      {id && <SupplierCaseDetail key={id} id={id} />}
    </div>
  );
}
