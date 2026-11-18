import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";
import { safeReturnPath } from "./fakturaer/visning";
import { VarekortPanel } from "./gjore/VarekortPanel";

/** Leverandørvaren (varekortet) som fullside: linjehistorikk, kobling og pakning for én leverandørvare. */
export default function VarekortPage() {
  const { supplierId = "", itemKey = "" } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // Leverandørvaren (detaljside) nås fra varen, leverandørkortet og Fra faktura; trygg retur, ellers Fra faktura.
  const back = safeReturnPath(sp.get("retur")) ?? paths.fraFaktura();
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-page py-4">
      <Link to={back} className="inline-flex items-center gap-1 text-caption text-ink-secondary hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Tilbake
      </Link>
      <div className="rounded-lg border border-border bg-card p-4">
        <VarekortPanel supplierId={supplierId} itemKey={itemKey} onNext={() => navigate(back)} onClose={() => navigate(back)} />
      </div>
    </div>
  );
}
