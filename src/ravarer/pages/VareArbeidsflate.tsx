import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { VarerShell } from "@/ravarer/pages/hub/VarerShell";
import { isVarelisteMode, readListe, VIEW_TO_LISTE } from "@/ravarer/lib/varerWorklist";
import { useActiveRow } from "@/ravarer/pages/varer/useActive";

const Vareliste = lazy(() => import("@/ravarer/pages/Vareliste"));
const PackageMode = lazy(() => import("@/ravarer/pages/varer/PackageMode"));
const DeclarationMode = lazy(() => import("@/ravarer/pages/varer/DeclarationMode"));
const NutritionMode = lazy(() => import("@/ravarer/pages/varer/NutritionMode"));
const DatasheetMode = lazy(() => import("@/ravarer/pages/varer/DatasheetMode"));

/**
 * Varearbeidsflaten (fase 4A): `/ravarer/varer?liste=…`. Én overskrift, arbeidslistene som lenker
 * (ulagret-vakten fanger bytte) og én modusadapter per liste. Alle moduser bruker felles DataTable +
 * SplitView: fra 1280 px liste og panel side om side, under 1280 px valgt detalj i full bredde.
 * Aktiv rad = `valgt` (råvare) / `endring` (hendelse) i URL-en.
 */
export default function VareArbeidsflate() {
  const [sp, setSp] = useSearchParams();
  const liste = readListe(sp);
  const { valgt, setActive } = useActiveRow();

  // Gammel `view` (uten `liste`) oversettes én gang til arbeidsliste.
  useEffect(() => {
    const v = sp.get("view");
    if (!sp.get("liste") && v && VIEW_TO_LISTE[v]) {
      const n = new URLSearchParams(sp);
      n.delete("view");
      n.set("liste", VIEW_TO_LISTE[v]);
      setSp(n, { replace: true });
    }
  }, [sp, setSp]);

  return (
    <VarerShell active={liste}>
      {isVarelisteMode(liste) && <Vareliste liste={liste} activeId={valgt} onActiveChange={(id) => setActive(id)} />}
      {liste === "pakning" && <PackageMode />}
      {liste === "deklarasjon" && <DeclarationMode />}
      {liste === "naering" && <NutritionMode />}
      {liste === "datablad" && <DatasheetMode />}
    </VarerShell>
  );
}
