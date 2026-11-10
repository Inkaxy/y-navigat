import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { recipeTabFrom, recipeTabSearch, type RecipeTabId } from "@/varer/lib/recipeTabs";

/**
 * Aktiv fane på oppskriftssiden, speilet i `?tab=`.
 *
 * Fanebytte skriver adressen med `history.replaceState` og beholder
 * historikkens tilstand. Da navigerer ikke routeren, vakten for ulagrede
 * endringer slår ikke inn, og vaktens ekstra historikkoppføring bevares.
 * En ekte navigasjon til en annen `?tab=` (lenke, tilbake) vinner.
 */
export function useRecipeTab(): [RecipeTabId, (tab: RecipeTabId) => void] {
  const [searchParams] = useSearchParams();
  const urlTab = recipeTabFrom(searchParams);
  const [tab, setTabState] = useState<RecipeTabId>(urlTab);
  const lastUrlTab = useRef(urlTab);

  useEffect(() => {
    if (lastUrlTab.current === urlTab) return;
    lastUrlTab.current = urlTab;
    setTabState(urlTab);
  }, [urlTab]);

  const setTab = useCallback((next: RecipeTabId) => {
    setTabState(next);
    const loc = window.location;
    const search = recipeTabSearch(loc.search, next);
    window.history.replaceState(window.history.state, "", `${loc.pathname}${search}${loc.hash}`);
  }, []);

  return [tab, setTab];
}
