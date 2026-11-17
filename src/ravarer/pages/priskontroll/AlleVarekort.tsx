import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Varekoblinger from "@/fakturaer/pages/Varekoblinger";
import { paths } from "@/ravarer/lib/paths";

/** Alle leverandørvarer (også Koblet og Ikke vare), nådd fra leverandørkort og varer. Radklikk åpner leverandørvaren. */
export default function AlleVarekort() {
  return (
    <div className="space-y-2">
      <div className="px-page pt-4">
        <Link to={paths.leverandorer()} className="inline-flex items-center gap-1 text-caption text-ink-secondary hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Leverandører
        </Link>
      </div>
      <Varekoblinger />
    </div>
  );
}
