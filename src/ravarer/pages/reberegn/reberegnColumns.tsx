import { Link } from "react-router-dom";
import { paths } from "@/ravarer/lib/paths";

/**
 * R192/R195: trygg innsyn fra hver vare til eksisterende, verifisert pris-/kildevisning og pakningslisten.
 * Bulk-svaret har ingen faktura-/linje-ID-er, så kilde, regnestykke og fakturaer vises der de faktisk er bevist:
 * råvarekortets prisseksjon (kostkilde, prishistorikk og fakturaer) — ikke det detaljerte regnestykket, som vises via
 * «Se serverens regnestykke» (SingleRecalcDetail). Ingenting fabrikkeres her.
 */
export function RecalcDrilldown({ rawMaterialId, name }: { rawMaterialId: string; name: string }) {
  const cls = "inline-flex min-h-[44px] items-center text-primary underline-offset-2 hover:underline";
  return (
    <span className="inline-flex flex-wrap gap-x-3" onClick={(e) => e.stopPropagation()}>
      <Link className={cls} to={paths.raavare(rawMaterialId, { seksjon: "pris" })} aria-label={`Pris, prishistorikk og fakturaer for ${name}`}>Pris og fakturaer</Link>
      <Link className={cls} to={paths.pakninger({ valgt: rawMaterialId })} aria-label={`Pakning for ${name}`}>Pakning</Link>
    </span>
  );
}
