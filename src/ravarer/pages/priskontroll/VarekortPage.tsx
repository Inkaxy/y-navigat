import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";
import { VarekortPanel } from "./gjore/VarekortPanel";

/** Varekortet som fullside (smale skjermer og direkte lenker). */
export default function VarekortPage() {
  const { supplierId = "", itemKey = "" } = useParams();
  const navigate = useNavigate();
  const back = paths.priskontroll({ fane: "gjore" });
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-page py-4">
      <Link to={back} className="inline-flex items-center gap-1 text-caption text-ink-secondary hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Tilbake til Å gjøre
      </Link>
      <div className="rounded-lg border border-border bg-card p-4">
        <VarekortPanel supplierId={supplierId} itemKey={itemKey} onNext={() => navigate(back)} onClose={() => navigate(back)} />
      </div>
    </div>
  );
}
