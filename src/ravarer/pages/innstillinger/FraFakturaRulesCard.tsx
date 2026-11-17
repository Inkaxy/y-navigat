import { useId, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useFraFakturaSettings, useSaveFraFakturaSettings } from "@/ravarer/hooks/useFraFaktura";
import { JUMP_CHOICES } from "@/ravarer/lib/fraFaktura/priceJumps";

/** Prisgrensen og reglene for Fra faktura (samlet her fra Automatikk/Prishopp). Egen grense per vare settes på Prishopp-raden. */
export function FraFakturaRulesCard({ canApprove }: { canApprove: boolean }) {
  const id = useId();
  const q = useFraFakturaSettings();
  const save = useSaveFraFakturaSettings();
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const s = q.data;
  const canSave = !!s && !s.pending && s.canEdit && canApprove;
  const run = async (patch: { pct?: number; quiet?: boolean; pkg?: boolean }) => {
    if (!s || lock.current) return;
    lock.current = true; setMsg(null);
    try { setMsg(await save(s, patch)); } finally { lock.current = false; }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id={`${id}-h`} className="text-body font-semibold">Prisgrense og nye varer fra faktura</h2>
      {q.isError ? <p role="alert" className="text-sm text-destructive">Innstillingene kunne ikke leses.</p>
        : !s ? <p className="text-sm text-ink-secondary">Henter innstillingene …</p>
        : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor={`${id}-g`}>Prishopp vises når prisen endrer seg mer enn</label>
              <select id={`${id}-g`} value={s.priceJumpPct} disabled={!canSave} onChange={(e) => void run({ pct: Number(e.target.value) })}
                className="h-11 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {[...new Set([...JUMP_CHOICES, s.priceJumpPct])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} %</option>)}
              </select>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <Switch checked={s.quietPrices} disabled={!canSave} onCheckedChange={(v) => void run({ quiet: v })} />
              Prisendringer under grensen føres uten spørsmål
            </label>
            <label className="flex min-h-[44px] items-center gap-3 text-sm">
              <Switch checked={s.invoicePackage} disabled={!canSave} onCheckedChange={(v) => void run({ pkg: v })} />
              Entydig pakning lest fra fakturaen gjelder uten egen godkjenning
            </label>
            <p className="text-caption text-ink-secondary">Egen grense for én vare settes på raden i Fra faktura › Prishopp.</p>
            {s.pending && <p className="text-caption text-ink-secondary">Grensen og reglene kan lagres når databaseendringen «Fra faktura» er kjørt. Til da gjelder 20 % og reglene er av.</p>}
            {!s.pending && !canSave && <p className="text-caption text-ink-secondary">Bare godkjennere kan endre dette.</p>}
          </div>
        )}
      {msg && <p role="alert" className="text-caption text-destructive">{msg}</p>}
    </section>
  );
}
