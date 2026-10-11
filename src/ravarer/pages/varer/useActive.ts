import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Aktiv rad i en arbeidsliste ligger i URL-en: `valgt` = råvare, `endring` = hendelse (datablad).
 * Nytt valg legges i historikken (Tilbake lukker panelet); lukking fjerner begge.
 */
export function useActiveRow() {
  const [sp, setSp] = useSearchParams();
  const valgt = sp.get("valgt");
  const endring = sp.get("endring");
  const setActive = useCallback(
    (materialId: string | null, eventId?: string | null) =>
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        if (materialId) n.set("valgt", materialId); else n.delete("valgt");
        if (materialId && eventId) n.set("endring", eventId); else n.delete("endring");
        return n;
      }),
    [setSp],
  );
  /** Listekontekst til full detalj: alt unntatt aktiv rad/hendelse. */
  const listSearch = (() => { const n = new URLSearchParams(sp); n.delete("valgt"); n.delete("endring"); return n.toString(); })();
  return { sp, setSp, valgt, endring, setActive, listSearch };
}
