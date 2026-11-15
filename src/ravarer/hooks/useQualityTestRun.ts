import { useCallback, useRef, useState } from "react";
import { QUALITY_TEST_SET } from "../../../supabase/functions/_shared/qualityTestSet.ts";
import { invokeConfigCheck, invokeQualityRead, planConfigs, type ConfigCheck, type PlannedConfig, type QualityResult, type SkippedConfig } from "@/ravarer/lib/qualityTest";

export type QualityPhase = "idle" | "checking" | "ready" | "running" | "done" | "stopped";

/** Feil som gjelder oppsettet (ikke fakturaen): da hoppes resten av fakturaene for oppsettet over. */
const CONFIG_STOP = new Set(["http", "model_unavailable", "no_credential", "config_missing", "invalid_model", "forbidden", "unauthorized"]);

/**
 * Kvalitetstest: 1) gratis nøkkelsjekk, 2) Henrik bekrefter, 3) én faktura om gangen, alle oppsett samtidig.
 * Lange fakturaer der produksjonen ville delt lesingen, leses også i sidebolker. Ingen nye forsøk.
 * Synkron lås hindrer dobbel start; «Stopp» avslutter etter fakturaen som pågår (sendte kall trekkes ikke tilbake).
 */
export function useQualityTestRun() {
  const [phase, setPhase] = useState<QualityPhase>("idle");
  const [checks, setChecks] = useState<ConfigCheck[]>([]);
  const [plan, setPlan] = useState<{ run: PlannedConfig[]; skipped: SkippedConfig[] }>({ run: [], skipped: [] });
  const [results, setResults] = useState<QualityResult[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stoppedConfigs, setStoppedConfigs] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const stop = useRef(false);

  const check = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setError(null); setPhase("checking");
    try {
      const c = await invokeConfigCheck();
      setChecks(c); setPlan(planConfigs(c)); setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nøkkelsjekken feilet."); setPhase("idle");
    } finally { lock.current = false; }
  }, []);

  const run = useCallback(async () => {
    if (lock.current || plan.run.length === 0) return;
    lock.current = true; stop.current = false;
    const configs = plan.run;
    setResults([]); setStoppedConfigs({}); setPhase("running");
    const halted: Record<string, string> = {};
    let dailyLimit = false;
    try {
      for (const inv of QUALITY_TEST_SET) {
        if (stop.current || dailyLimit) break;
        const active = configs.filter((c) => !halted[c.check.configId]);
        if (!active.length) break;
        setCurrent(`${inv.supplier} ${inv.invoice_number}`);
        await Promise.all(active.map(async (cfg) => {
          const single = await invokeQualityRead(inv.invoice_id, cfg, "enkelt");
          setResults((p) => [...p, single]);
          if (single.status === "daily_limit") { dailyLimit = true; return; }
          if (CONFIG_STOP.has(single.status)) { halted[cfg.check.configId] = single.error ?? single.statusLabel; setStoppedConfigs({ ...halted }); return; }
          if (single.chunkSuggested && (single.totalPages ?? 0) >= 2 && !stop.current) {
            const chunk = await invokeQualityRead(inv.invoice_id, cfg, "sidebolker");
            setResults((p) => [...p, chunk]);
            if (chunk.status === "daily_limit") dailyLimit = true;
          }
        }));
      }
      if (dailyLimit) setError("Døgntaket for sammenligninger ble nådd. Resten av testen kan kjøres i morgen.");
      setPhase(stop.current || dailyLimit ? "stopped" : "done");
    } finally {
      setCurrent(null); lock.current = false;
    }
  }, [plan]);

  const requestStop = useCallback(() => { stop.current = true; }, []);

  return { phase, checks, plan, results, current, error, stoppedConfigs, check, run, requestStop };
}
