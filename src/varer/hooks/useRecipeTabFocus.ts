import { useCallback, useEffect, useRef, useState } from "react";
import { goToSection } from "@/varer/components/recipes/editor/RecipeSections";
import { focusRecipeLine } from "@/varer/lib/recipeWarningGroups";
import { recipeTabForAnchor, type RecipeTabId } from "@/varer/lib/recipeTabs";
import type { RemainingTarget } from "@/varer/lib/recipeRemaining";

/** Flytter fokus til målet etter at fanen er tegnet. Sann når målet fantes. */
export function focusRecipeTarget(t: RemainingTarget, root: Document = document): boolean {
  if (t.kind === "line") {
    if (focusRecipeLine(t.lineId)) return true;
    return goToSection("seksjon-ingredienser", root);
  }
  if (t.kind === "anchor") {
    if (goToSection(t.id, root)) return true;
    const el = root.getElementById(t.id);
    if (!el) return false;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.focus({ preventScroll: true });
    return true;
  }
  if (t.kind === "product") {
    const el = root.getElementById(`vare-${t.productId}`);
    if (!el) return goToSection("seksjon-koblinger", root);
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.querySelector<HTMLElement>("a[href], button")?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

/**
 * Fanebytte med fokus. Inaktive faner er ikke montert, så fokus settes først
 * når den nye fanen er tegnet. Mål i merkefanen sendes videre som en
 * forespørsel til `LabelTab` (samme snarvei som «Rett felt»).
 */
export function useRecipeTabFocus(activeTab: RecipeTabId, setTab: (tab: RecipeTabId) => void) {
  const seq = useRef(0);
  const [pending, setPending] = useState<{ target: RemainingTarget; seq: number } | null>(null);
  const [labelFix, setLabelFix] = useState<{ key: string; seq: number } | null>(null);

  const goTo = useCallback(
    (tab: RecipeTabId, target: RemainingTarget | null) => {
      seq.current += 1;
      setTab(tab);
      if (target?.kind === "label") {
        setLabelFix({ key: target.key, seq: seq.current });
        return;
      }
      if (target) setPending({ target, seq: seq.current });
    },
    [setTab],
  );

  /** Anker som `seksjon-*`: bytt til fanen ankeret ligger i, og fokuser. */
  const goToAnchor = useCallback(
    (anchor: string) => {
      const tab = recipeTabForAnchor(anchor);
      if (!tab) return;
      const id = anchor.replace(/^#/, "");
      goTo(tab, tab === "merking" ? null : { kind: "anchor", id });
    },
    [goTo],
  );

  // En gammel forespørsel skal ikke slå inn igjen neste gang merkefanen åpnes.
  useEffect(() => {
    if (activeTab !== "merking") setLabelFix(null);
  }, [activeTab]);

  useEffect(() => {
    if (!pending) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        focusRecipeTarget(pending.target);
        setPending(null);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [pending, activeTab]);

  return { goTo, goToAnchor, labelFix };
}
