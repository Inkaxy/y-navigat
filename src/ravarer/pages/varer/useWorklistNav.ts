import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useVarelisteItems } from "@/ravarer/hooks/useVarelisteItems";
import { usePackageWorklist } from "@/ravarer/hooks/usePackageSizes";
import { useSuspiciousPackages } from "@/ravarer/hooks/useSuspiciousPackages";
import { useDeclarationWorklist } from "@/ravarer/hooks/useDeclarationNames";
import { useNutritionCoverage } from "@/ravarer/hooks/useNutritionCoverage";
import { useChangelog } from "@/ravarer/hooks/useDatasheets";
import { DEFAULT_HARD_CAP_PCT, useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { filterAndSortItems, parseListQuery } from "@/ravarer/lib/rawMaterialViews";
import { deviationRuleFor } from "@/ravarer/lib/varerOrder";
import { isVarelisteMode, readListe } from "@/ravarer/lib/varerWorklist";
import { readNutritionSkipped } from "@/ravarer/lib/nutritionSkip";
import {
  orderDatasheetRows, orderDeclarationRows, orderNutritionRows, orderPackageRows, readDatasheetView, readPackageQuery, stepEntries, type NavEntry,
} from "./modeLogic";

/**
 * Forrige/neste på råvarekortet i NØYAKTIG samme rekkefølge som arbeidslisten brukeren kom fra.
 * Bruker samme data-hooks og samme ordningsfunksjoner som modusadapterne. Henter bare listen
 * som faktisk er kontekst (eller er i cache for standardlisten) — ingen tung henting for direktelenker.
 */
export function useWorklistNav(listSearch: string, materialId: string | undefined, eventId: string | null) {
  const sp = useMemo(() => new URLSearchParams(listSearch), [listSearch]);
  const liste = readListe(sp);
  const { legalEntityId } = useRavarer();
  const qc = useQueryClient();
  const hasContext = listSearch.length > 0 || qc.getQueryState(["raw_materials", legalEntityId])?.data != null;

  const vl = hasContext && isVarelisteMode(liste);
  const { items } = useVarelisteItems({ enabled: vl });
  const tolerances = useMatchTolerances(legalEntityId);
  const hardCap = tolerances.settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT;

  const pkg = usePackageWorklist({ enabled: hasContext && liste === "pakning" });
  const susp = useSuspiciousPackages({ enabled: hasContext && liste === "pakning" });
  const decl = useDeclarationWorklist(legalEntityId, { enabled: hasContext && liste === "deklarasjon" });
  const cov = useNutritionCoverage({ enabled: hasContext && liste === "naering" });
  const view = readDatasheetView(sp);
  const ds = useChangelog({ onlyUnacked: view === "unacked" }, { enabled: hasContext && liste === "datablad" });

  // «Hopp over» i næringslisten (økt) — samme utvalg som listen brukeren så.
  const skippedKey = liste === "naering" ? [...readNutritionSkipped(legalEntityId ?? null)].sort().join(",") : "";

  const entries = useMemo<NavEntry[]>(() => {
    if (!hasContext) return [];
    const q = sp.get("q") ?? "";
    switch (liste) {
      case "pakning": {
        const ids = new Set((susp.data ?? []).map((s) => s.raw_material_id));
        return orderPackageRows(pkg.data ?? [], readPackageQuery(sp), ids).map((r) => ({ materialId: r.id }));
      }
      case "deklarasjon": {
        const rows = decl.data ?? [];
        return [...orderDeclarationRows(rows.filter((r) => !r.is_composite), q), ...orderDeclarationRows(rows.filter((r) => r.is_composite), q)].map((r) => ({ materialId: r.raw_material_id }));
      }
      case "naering":
        return orderNutritionRows((cov.data?.candidates ?? []).map((c) => ({ raw_material_id: c.raw_material_id, name: c.name })), q, new Set(skippedKey ? skippedKey.split(",") : [])).map((r) => ({ materialId: r.raw_material_id }));
      case "datablad":
        return orderDatasheetRows(ds.data ?? [], q).map((r) => ({ materialId: r.raw_material_id, eventId: r.id }));
      default:
        return filterAndSortItems(items, parseListQuery(sp), deviationRuleFor(tolerances.toleranceFor, hardCap)).map((i) => ({ materialId: i.id }));
    }
  }, [hasContext, liste, sp, susp.data, pkg.data, decl.data, cov.data, ds.data, items, tolerances, hardCap, skippedKey]);

  const loaded = hasContext && (
    liste === "pakning" ? pkg.data !== undefined && susp.data !== undefined
      : liste === "deklarasjon" ? decl.data !== undefined
      : liste === "naering" ? cov.data !== undefined
      : liste === "datablad" ? ds.data !== undefined
      : items.length > 0
  );
  const step = materialId ? stepEntries(entries, materialId, liste === "datablad" ? eventId : null) : { prev: null, next: null, index: -1 };
  // Raden er borte fra listen (kvittert, hoppet over, løst): ingen falske naboer — «neste» blir første i gjeldende liste.
  const missing = !!materialId && loaded && step.index < 0;
  if (missing) return { liste, prev: null, next: entries[0] ?? null, index: -1, total: entries.length, missing };
  return { liste, ...step, total: entries.length, missing };
}
