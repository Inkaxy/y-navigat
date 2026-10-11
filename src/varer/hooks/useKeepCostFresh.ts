import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Nøklene som bærer kostpriser i åpne kalkyler (oppskrift, halvfabrikat, produkt). */
export const COST_FRESH_KEYS: readonly string[] = ["product-cost", "product-margins", "product-margin-rows", "recipe-detail", "recipe-composite"];

/**
 * Åpne kalkyler skal ikke bli stille gamle når en kostpris endres et annet sted
 * (faktura, annen fane, dagsjobb). Henter på nytt når fanen får fokus igjen og hvert
 * `intervalMs` mens den er synlig. Råvaretabellen sendes ikke over realtime.
 */
export function useKeepCostFresh(intervalMs = 120_000): void {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const k of COST_FRESH_KEYS) void qc.invalidateQueries({ queryKey: [k] });
    };
    const id = window.setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [qc, intervalMs]);
}
