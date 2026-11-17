import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QueryState } from "@/components/common/QueryState";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { callPendingRpc } from "@/lib/pendingRpc";
import { useRecipeUsage } from "@/varer/hooks/usePrisgrunnlag";
import type { AddLineItem } from "@/varer/hooks/usePriceRounds";
import { AddToPriceRoundDialog } from "@/varer/components/prices/AddToPriceRoundDialog";
import { usePriceJumps, useSupplierNames } from "@/ravarer/hooks/useFraFaktura";
import { JUMP_CHOICES, belowLimitCount } from "@/ravarer/lib/fraFaktura/priceJumps";
import { PriceJumpRow } from "./PriceJumpRow";

/** Prishopp (D3): bare priser som hopper mer enn grensen. Vanlige prisendringer føres rett på varen. */
export function PriceJumpsTab({ localLimit, onLocalLimit, canWrite, canApprove, retur }: {
  localLimit: number | null; onLocalLimit: (v: number | null) => void; canWrite: boolean; canApprove: boolean; retur: string;
}) {
  const id = useId();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const { user } = useAuth();
  const p = usePriceJumps(localLimit);
  const names = useSupplierNames();
  const usage = useRecipeUsage(company?.id ?? null);
  const s = p.settings.data;
  const canSave = !!s && !s.pending && s.canEdit && canApprove;
  const [round, setRound] = useState<{ key: string; items: AddLineItem[] } | null>(null);
  const [inRound, setInRound] = useState<Map<string, number>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);

  const save = async (patch: { pct?: number; quiet?: boolean; pkg?: boolean }) => {
    if (!company || lock.current || !s) return;
    lock.current = true; setMsg(null);
    const r = await callPendingRpc("rm_set_fra_faktura_settings", {
      p_legal_entity_id: company.id, p_price_jump_pct: patch.pct ?? (s.isDefault ? null : s.priceJumpPct),
      p_quiet_prices: patch.quiet ?? null, p_invoice_package: patch.pkg ?? null,
    });
    lock.current = false;
    if (r.kind !== "ok") setMsg(r.kind === "denied" ? "Bare godkjennere kan endre dette." : "Endringen ble ikke lagret. Prøv igjen.");
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
  };
  const onLimit = (v: number) => { if (canSave) { onLocalLimit(null); void save({ pct: v }); } else onLocalLimit(v === (s?.priceJumpPct ?? 20) ? null : v); };
  const below = p.lines.data && p.items.data ? belowLimitCount(p.lines.data, p.limitFor) : null;

  return (
    <section aria-labelledby="ff-pris" className="overflow-hidden rounded-2xl border border-line-subtle bg-card">
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="ff-pris" className="font-serif text-title">Priser som hopper mer enn grensen</h2>
          <p className="text-body text-ink-secondary">Vanlige prisendringer føres rett på varen og vises i historikken. Her ligger bare de som er større enn grensen din.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm text-ink-secondary">Grense</label>
          <select id={id} value={p.limit} onChange={(e) => onLimit(Number(e.target.value))}
            className="h-11 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {[...new Set([...JUMP_CHOICES, p.limit])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} %</option>)}
          </select>
        </div>
      </div>
      {!canSave && localLimit != null && (
        <p className="px-5 pb-2 text-caption text-ink-secondary">
          {s?.pending ? "Grensen gjelder bare visningen til databaseendringen «Fra faktura» er kjørt." : "Bare godkjennere kan endre grensen for alle. Grensen gjelder bare visningen din."}
        </p>
      )}
      <QueryState isLoading={p.isLoading} isError={p.isError} error={p.lines.error ?? p.items.error} scope="ravarer:fra-faktura:prishopp" onRetry={() => void p.lines.refetch()}>
        {(p.jumps ?? []).length === 0 ? (
          <p className="border-t border-line-subtle px-5 py-8 text-center text-body text-ink-secondary">Ingen priser hopper mer enn {p.limit} % akkurat nå.</p>
        ) : (
          <ul aria-label="Prishopp">
            {(p.jumps ?? []).map((j) => (
              <PriceJumpRow key={j.key} j={j} supplierName={names.get(j.supplierId) ?? null} usage={usage.data} canWrite={canWrite} retur={retur}
                onRound={(key, items) => setRound({ key, items })} inRound={inRound.get(j.key) ?? null} />
            ))}
          </ul>
        )}
      </QueryState>
      <div className="space-y-2 border-t border-line-subtle px-5 py-3 text-caption text-ink-secondary">
        {below != null && below > 0 && (s?.pending || !s?.quietPrices) && (
          <p>{below} {below === 1 ? "mindre prisendring" : "mindre prisendringer"} under grensen venter fortsatt under «Øvrige spørsmål» til regelen under er slått på.</p>
        )}
        {s && !s.pending ? (
          <div className="flex flex-col gap-2">
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-foreground">
              <Switch checked={s.quietPrices} disabled={!canSave} onCheckedChange={(v) => void save({ quiet: v })} />
              Prisendringer under grensen føres uten spørsmål
            </label>
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-foreground">
              <Switch checked={s.invoicePackage} disabled={!canSave} onCheckedChange={(v) => void save({ pkg: v })} />
              Entydig pakning lest fra fakturaen gjelder uten egen godkjenning
            </label>
          </div>
        ) : <p>Reglene for matchingen (stille prisendring under grensen, pakning lest fra fakturaen) kan slås på når databaseendringen «Fra faktura» er kjørt.</p>}
        {msg && <p role="alert" className="text-destructive">{msg}</p>}
      </div>
      <AddToPriceRoundDialog open={round != null} onOpenChange={(o) => !o && setRound(null)} legalEntityId={company?.id ?? null} userId={user?.id ?? null}
        items={round?.items ?? []} onAdded={(n) => { if (round) setInRound((m) => new Map(m).set(round.key, n)); }} />
    </section>
  );
}
