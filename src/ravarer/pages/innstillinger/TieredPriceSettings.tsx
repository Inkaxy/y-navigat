import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/userError";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { parseDecimal } from "@/fakturaer/lib/units";
import { FALLBACK_TOLERANCE_PCT, DEFAULT_HARD_CAP_PCT, DEFAULT_MIN_IMPACT_NOK, type MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";
import { cn } from "@/lib/utils";
import { parseRematchQueued } from "@/fakturaer/lib/parseRpcJson";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";

const LINE_KINDS = [
  ["frakt", "Frakt"], ["gebyr", "Gebyr"], ["avrunding", "Avrunding"], ["rabatt", "Rabatt"], ["pant", "Pant"], ["mva", "Mva"], ["annet", "Annet"],
] as const;

interface Draft {
  tol: string; minImpact: string; hardCap: string;
  firstPrice: boolean; inferPkg: boolean; autoReconcile: boolean; kinds: string[];
}

const fromSettings = (s: MatchSettings | null): Draft => ({
  tol: String(s?.default_price_tolerance_pct ?? FALLBACK_TOLERANCE_PCT).replace(".", ","),
  minImpact: String(s?.price_min_impact_nok ?? DEFAULT_MIN_IMPACT_NOK).replace(".", ","),
  hardCap: String(s?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT).replace(".", ","),
  firstPrice: s?.auto_accept_first_price ?? true,
  inferPkg: s?.auto_confirm_inferred_package ?? true,
  autoReconcile: s?.auto_reconcile_clean_imports ?? true,
  kinds: s?.auto_exclude_line_kinds ?? ["frakt", "gebyr", "avrunding", "rabatt"],
});

export function TieredPriceSettings({ legalEntityId, settings, canWrite, loading }: { legalEntityId: string | null; settings: MatchSettings | null; canWrite: boolean; loading: boolean }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => fromSettings(settings));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  // Bakgrunnsrefetch skal aldri overskrive et påbegynt utkast.
  useEffect(() => { if (!dirty) setD(fromSettings(settings)); }, [settings, dirty]);
  const status = useRematchStatus(legalEntityId);
  const busy = (status.data?.queued ?? 0) + (status.data?.in_flight ?? 0) > 0;

  const tol = parseDecimal(d.tol), minImpact = parseDecimal(d.minImpact), hardCap = parseDecimal(d.hardCap);
  const valid = tol != null && tol >= 0 && minImpact != null && minImpact >= 0 && hardCap != null && tol != null && hardCap >= tol;

  const save = useMutation({
    mutationFn: async () => {
      if (!legalEntityId || !valid) throw new Error("ugyldig");
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("invoice_match_settings").upsert({
        legal_entity_id: legalEntityId,
        default_price_tolerance_pct: tol, price_min_impact_nok: minImpact, price_hard_cap_pct: hardCap,
        auto_accept_first_price: d.firstPrice, auto_confirm_inferred_package: d.inferPkg, auto_reconcile_clean_imports: d.autoReconcile,
        auto_exclude_line_kinds: d.kinds, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null,
      }, { onConflict: "legal_entity_id" });
      if (error) throw error;
    },
    onSuccess: async () => { invalidateRavarerCounts(qc); setSaved(true); await qc.invalidateQueries({ queryKey: ["invoice-match-tolerances"] }); setDirty(false); },
    onError: (e) => showError("nivadelt-prisavvik", e, "Kunne ikke lagre innstillingene"),
  });

  const rematch = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rm_rematch_invoices", { p_legal_entity_id: legalEntityId!, p_limit: 500, p_only_open: true });
      if (error) throw error;
      return parseRematchQueued(data).queued;
    },
    onSuccess: (n) => { invalidateRavarerCounts(qc); setQueued(n); void qc.invalidateQueries({ queryKey: ["rematch-status"] }); },
    onError: (e) => showError("rematch-alle", e, "Kunne ikke starte ny beregning"),
  });

  const change = (p: Partial<Draft>) => { setSaved(false); setDirty(true); setD((x) => ({ ...x, ...p })); };
  const example = valid ? evaluatePriceDeviation({ actual: 10.42, expected: 10, baseQuantity: 50, tolPct: tol, minImpactNok: minImpact, hardCapPct: hardCap }) : null;
  const dis = !canWrite || loading;

  const num = (id: string, label: string, v: string, on: (s: string) => void) => (
    <div>
      <Label htmlFor={id} className="text-caption">{label}</Label>
      <Input id={id} inputMode="decimal" value={v} disabled={dis} onChange={(e) => on(e.target.value)} className="mt-1 tabular-nums" />
    </div>
  );
  const toggle = (label: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm"><span>{label}</span><Switch checked={checked} disabled={dis} onCheckedChange={on} /></label>
  );

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Nivådelt prisavvik</h2>
        <p className="text-caption text-ink-secondary">Et avvik går til kontroll når det er over maksgrensen, eller over toleransen og samtidig over minstebeløpet i kroner.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {num("tp-tol", "Toleranse (%)", d.tol, (v) => change({ tol: v }))}
        {num("tp-min", "Minste kronevirkning før avvik teller (kr)", d.minImpact, (v) => change({ minImpact: v }))}
        {num("tp-cap", "Maksgrense (%) — over dette går linjen alltid til kontroll", d.hardCap, (v) => change({ hardCap: v }))}
      </div>
      {!valid && <p className="text-caption text-destructive">Fyll inn gyldige tall. Maksgrensen må være minst like høy som toleransen.</p>}
      {example && (
        <p className="rounded-md bg-muted/40 p-2 text-caption">
          Eksempel: 50 kg kjøpt til 10,42 kr/kg mot 10,00 kr/kg gir {example.explanation}. {example.large ? "Linjen går til kontroll." : "Linjen går ikke til kontroll."}
        </p>
      )}
      <div className="space-y-3 border-t border-line-subtle pt-3">
        {toggle("Godta første dokumenterte pris automatisk", d.firstPrice, (v) => change({ firstPrice: v }))}
        {toggle("Bekreft pakning automatisk når regnestykket og varenavnet er enige", d.inferPkg, (v) => change({ inferPkg: v }))}
        {toggle("Avstem rene fakturaer automatisk", d.autoReconcile, (v) => change({ autoReconcile: v }))}
      </div>
      <div>
        <p className="text-caption">Linjetyper som utelates automatisk</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {LINE_KINDS.map(([k, l]) => {
            const on = d.kinds.includes(k);
            return (
              <button key={k} type="button" disabled={dis} aria-pressed={on} onClick={() => change({ kinds: on ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] })}
                className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary/10 text-primary" : "border-line-subtle text-ink-secondary")}>
                {l}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-3">
        <Button type="button" disabled={dis || !valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Lagre
        </Button>
        {saved && <span role="status" className="inline-flex items-center gap-1 text-sm text-success"><Check className="h-4 w-4" aria-hidden />Lagret</span>}
        <Button type="button" variant="outline" disabled={dis || !legalEntityId || rematch.isPending || busy} onClick={() => rematch.mutate()}>
          {rematch.isPending || busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}
          {busy ? "Omberegning pågår…" : "Beregn alle åpne fakturaer på nytt"}
        </Button>
        {queued != null && <span role="status" className="text-sm text-ink-secondary">{queued} fakturaer satt i kø — resultatet vises om noen minutter</span>}
      </div>
      {status.data && (
        <p className="text-caption text-ink-secondary tabular-nums">
          {status.data.queued} i kø · {status.data.in_flight} under arbeid · {status.data.done_last_hour} ferdige siste time · {status.data.failed_last_day} feilet siste døgn
        </p>
      )}
    </Card>
  );
}
