import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { parseDecimal } from "@/fakturaer/lib/units";
import { cn } from "@/lib/utils";
import { RematchAllDialog } from "@/ravarer/components/RematchAllDialog";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import type { PriceDraft } from "@/ravarer/lib/priceSettingsDraft";

const LINE_KINDS = [
  ["frakt", "Frakt"], ["gebyr", "Gebyr"], ["avrunding", "Avrunding"], ["rabatt", "Rabatt"], ["pant", "Pant"], ["mva", "Mva"], ["annet", "Annet"],
] as const;

/**
 * Nivådelt prisavvik og automatikk — del av den felles kladden (ingen egen lagring).
 * «Beregn alle åpne på nytt» er en egen, eksplisitt handling med egen bekreftelse.
 */
export function TieredPriceSettings({ draft, update, disabled, legalEntityId, canWrite }: {
  draft: PriceDraft; update: (p: Partial<PriceDraft>) => void; disabled: boolean; legalEntityId: string | null; canWrite: boolean;
}) {
  const [rematchOpen, setRematchOpen] = useState(false);
  const status = useRematchStatus(legalEntityId);
  const busy = (status.data?.queued ?? 0) + (status.data?.in_flight ?? 0) > 0;
  const tol = parseDecimal(draft.tol), minImpact = parseDecimal(draft.minImpact), hardCap = parseDecimal(draft.hardCap);
  const valid = tol != null && tol >= 0 && minImpact != null && minImpact >= 0 && hardCap != null && hardCap >= tol;
  const example = valid ? evaluatePriceDeviation({ actual: 10.42, expected: 10, baseQuantity: 50, tolPct: tol, minImpactNok: minImpact, hardCapPct: hardCap }) : null;

  const num = (id: string, label: string, v: string, on: (s: string) => void) => (
    <div>
      <Label htmlFor={id} className="text-caption">{label}</Label>
      <Input id={id} inputMode="decimal" value={v} disabled={disabled} onChange={(e) => on(e.target.value)} className="mt-1 min-h-[44px] tabular-nums md:min-h-10" />
    </div>
  );
  const toggle = (label: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm"><span>{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={on} aria-label={label} /></label>
  );

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Nivådelt prisavvik</h2>
        <p className="text-caption text-ink-secondary">
          Et avvik går til kontroll når det er over maksgrensen, eller over toleransen og samtidig over minstebeløpet i kroner.
          Toleransen gjelder alle varer uten egen kategoritoleranse (se nederst); maksgrensen gjelder alltid.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {num("tp-tol", "Toleranse (%)", draft.tol, (v) => update({ tol: v }))}
        {num("tp-min", "Minste kronevirkning før avvik teller (kr)", draft.minImpact, (v) => update({ minImpact: v }))}
        {num("tp-cap", "Maksgrense (%) — over dette går linjen alltid til kontroll", draft.hardCap, (v) => update({ hardCap: v }))}
      </div>
      {example && (
        <p className="rounded-md bg-muted/40 p-2 text-caption">
          Eksempel: 50 kg kjøpt til 10,42 kr/kg mot 10,00 kr/kg gir {example.explanation}. {example.large ? "Linjen går til kontroll." : "Linjen går ikke til kontroll."}
        </p>
      )}
      <div className="space-y-1 border-t border-line-subtle pt-3">
        {toggle("Godta første dokumenterte pris automatisk", draft.firstPrice, (v) => update({ firstPrice: v }))}
        {toggle("Bekreft pakning automatisk når regnestykket og varenavnet er enige", draft.inferPkg, (v) => update({ inferPkg: v }))}
        {toggle("Avstem rene fakturaer automatisk", draft.autoReconcile, (v) => update({ autoReconcile: v }))}
      </div>
      <div>
        <p className="text-caption">Linjetyper som utelates automatisk</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {LINE_KINDS.map(([k, l]) => {
            const on = draft.kinds.includes(k);
            return (
              <button key={k} type="button" disabled={disabled} aria-pressed={on} onClick={() => update({ kinds: on ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k] })}
                className={cn("min-h-[44px] rounded-full border px-3 text-sm md:min-h-8", on ? "border-primary bg-primary/10 text-primary" : "border-line-subtle text-ink-secondary")}>
                {l}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-3">
        <Button type="button" variant="outline" className="min-h-[44px] md:min-h-10" disabled={!legalEntityId} onClick={() => setRematchOpen(true)}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}
          {busy ? "Omberegning pågår …" : "Beregn alle åpne fakturaer på nytt …"}
        </Button>
        <span className="text-caption text-ink-secondary">Bruker lagrede innstillinger, ikke ulagrede endringer.</span>
      </div>
      {status.data && (
        <p className="text-caption text-ink-secondary tabular-nums">
          {status.data.queued} i kø · {status.data.in_flight} under arbeid · {status.data.done_last_hour} ferdige siste time · {status.data.failed_last_day} feilet siste døgn
        </p>
      )}
      <RematchAllDialog open={rematchOpen} onOpenChange={setRematchOpen} legalEntityId={legalEntityId} canWrite={canWrite} />
    </Card>
  );
}
