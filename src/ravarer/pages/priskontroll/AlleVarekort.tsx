import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Varekoblinger from "@/fakturaer/pages/Varekoblinger";
import { paths } from "@/ravarer/lib/paths";

/** Verktøy › Alle varekort: hele oversikten (også Koblet og Ikke vare). Radklikk åpner varekortet. */
export default function AlleVarekort() {
  return (
    <div className="space-y-2">
      <div className="px-page pt-4">
        <Link to={paths.priskontroll({ fane: "gjore" })} className="inline-flex items-center gap-1 text-caption text-ink-secondary hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Priskontroll
        </Link>
      </div>
      <Varekoblinger />
    </div>
  );
}
