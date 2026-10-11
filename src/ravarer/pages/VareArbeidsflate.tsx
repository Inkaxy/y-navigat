import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { VarerShell } from "@/ravarer/pages/hub/VarerShell";
import { RawMaterialPeek } from "@/ravarer/components/vareliste/RawMaterialPeek";
import { isVarelisteMode, readListe, VIEW_TO_LISTE } from "@/ravarer/lib/varerWorklist";

const Vareliste = lazy(() => import("@/ravarer/pages/Vareliste"));
const PackageSizes = lazy(() => import("@/ravarer/pages/PackageSizes"));
const Deklarasjonsnavn = lazy(() => import("@/ravarer/pages/Deklarasjonsnavn"));
const KobleMatvaretabellen = lazy(() => import("@/ravarer/pages/KobleMatvaretabellen"));
const DatabladEndringer = lazy(() => import("@/ravarer/pages/DatabladEndringer"));

/**
 * Varearbeidsflaten (fase 4A): `/ravarer/varer?liste=…`. Én overskrift, arbeidslistene som lenker
 * (ulagret-vakten fanger bytte), og eksisterende motorer for hver liste. Valgt råvare (`valgt`)
 * vises i et peek-panel som er synlig på alle bredder.
 */
export default function VareArbeidsflate() {
  const [sp, setSp] = useSearchParams();
  const liste = readListe(sp);

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

  const valgt = isVarelisteMode(liste) ? sp.get("valgt") : null;
  const setValgt = (id: string | null) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (id) n.set("valgt", id); else n.delete("valgt");
    return n;
  });
  const listSearch = (() => { const n = new URLSearchParams(sp); n.delete("valgt"); return n.toString(); })();

  return (
    <VarerShell active={liste}>
      {isVarelisteMode(liste) && <Vareliste liste={liste} onPeek={setValgt} activeId={valgt} />}
      {liste === "pakning" && <PackageSizes />}
      {liste === "deklarasjon" && <Deklarasjonsnavn />}
      {liste === "naering" && <KobleMatvaretabellen />}
      {liste === "datablad" && <DatabladEndringer />}
      <RawMaterialPeek id={valgt} listSearch={listSearch} onClose={() => setValgt(null)} />
    </VarerShell>
  );
}
