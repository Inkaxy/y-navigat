import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupplierItemLines, useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { paths } from "@/ravarer/lib/paths";
import { consequenceText, formatPct, jumpCause, type PriceJump } from "@/ravarer/lib/fraFaktura/priceJumps";
import type { RecipeUsage } from "@/varer/hooks/usePrisgrunnlag";
import type { AddLineItem } from "@/varer/hooks/usePriceRounds";
import { useQuickAnswers } from "../beslutninger/useQuickAnswers";
import { useDecisionUndo } from "../beslutninger/useDecisionUndo";
import { PackageFix } from "../beslutninger/PackageFix";
import { usePriceConsequence } from "./usePriceConsequence";
import { ItemLimitSelect } from "./ItemLimitSelect";
import { AskSupplier } from "./AskSupplier";
import { cn } from "@/lib/utils";

const kr = (v: number) => v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ett prishopp (D3): gammel → ny pris, årsak, konsekvens og svarene (også «Spør leverandøren»). Godtar bare serverkontrollerte linjer. */
export function PriceJumpRow({ j, supplierName, usage, canWrite, retur, onRound, inRound, itemLimit, onAnswered }: {
  j: PriceJump; supplierName: string | null; usage: readonly RecipeUsage[] | undefined; canWrite: boolean; retur: string;
  onRound: (key: string, items: AddLineItem[]) => void; inRound: number | null;
  /** Kalles når raden er besvart, slik at listen holder kvitteringen synlig selv om prishoppet forsvinner ved neste henting. */
  onAnswered?: (key: string) => void;
  /** Når satt: godkjenner kan sette egen grense for varen (SQL kjørt). */
  itemLimit?: { current: number | null; companyLimit: number } | null;
}) {
  const itemQ = useSupplierItems({ supplierId: j.supplierId, itemKey: j.itemKey, pageSize: 1 });
  const item = itemQ.data?.items[0] ?? null;
  const linesQ = useSupplierItemLines(j.supplierId, j.itemKey);
  const lines = linesQ.data ?? [];
  const qa = useQuickAnswers(item, lines);
  const undo = useDecisionUndo();
  const [fix, setFix] = useState(false);
  const [done, setDoneState] = useState<{ text: string; undo: Parameters<typeof undo.undo>[0] | null; caseId?: string | null } | null>(null);
  const setDone = (v: NonNullable<typeof done>) => { setDoneState(v); onAnswered?.(j.key); };
  const cause = jumpCause(j, { hasAgreement: item?.agreed_price_per_base_unit != null });
  const cons = usePriceConsequence(j, usage, `Prishopp ${j.name} ${formatPct(j.pct)} (faktura ${j.invoiceNumber ?? "uten nummer"})`);
  const c = consequenceText(cons.recipes, cons.falling, cause.packageSuspect);
  const unit = j.baseUnit ?? "enhet";

  const accept = async () => {
    const r = await qa.acceptAll();
    if (r) setDone({ text: r.result.title, undo: r.undo });
  };

  if (done) {
    return (
      <li role="status" className="flex flex-wrap items-center gap-2 border-t border-line-subtle bg-success/10 px-4 py-3 text-sm md:px-5">
        <Check className="h-4 w-4 text-success" aria-hidden /><span className="font-semibold">{j.name}</span><span aria-hidden>→</span><span>{done.text}</span>
        {done.caseId && <Link className="font-semibold text-primary hover:underline" to={paths.sak(done.caseId)}>Åpne leverandørsaken</Link>}
        {done.undo && undo.canUndo(done.undo) && undo.state.kind !== "done" && (
          <Button variant="ghost" size="sm" className="ml-auto min-h-[44px] gap-1.5" disabled={undo.state.kind === "busy"} onClick={() => done.undo && void undo.undo(done.undo)}>
            <Undo2 className="h-4 w-4" aria-hidden />Angre
          </Button>
        )}
        {undo.state.kind === "done" && <span className="w-full text-caption">{undo.state.text}</span>}
        {undo.state.kind === "error" && <span role="alert" className="w-full text-caption text-destructive">{undo.state.text}</span>}
      </li>
    );
  }

  const ready = !!item && qa.priceStatus === "ready" && qa.rows.length > 0;
  return (
    <li className="border-t border-line-subtle px-4 py-4 md:px-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="text-body font-semibold">{j.name}</p>
          <p className="text-caption text-ink-secondary">{supplierName ?? "Ukjent leverandør"} · <Link className="hover:underline" to={paths.faktura(j.invoiceId, { linje: j.lineId, retur })}>faktura {j.invoiceNumber ?? "uten nummer"}</Link></p>
        </div>
        <p className="flex flex-wrap items-center gap-2 tabular-nums">
          <span className="text-ink-secondary">{kr(j.oldPrice)}</span><span aria-hidden>→</span><span className="sr-only">til</span>
          <span className="text-body font-semibold">{kr(j.newPrice)} kr/{unit}</span>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-semibold text-destructive">{formatPct(j.pct)}</span>
        </p>
        <div className="text-sm">
          <p className="text-ink-secondary">{cause.text}</p>
          <p className={cn("font-semibold", c.danger ? "text-destructive" : "text-foreground")}>{c.text}</p>
        </div>
        <div className="flex flex-col gap-2 lg:w-[19rem]">
          <div className="flex gap-2">
            <Button className="min-h-[44px] flex-1" disabled={!canWrite || !ready || qa.busy} onClick={() => void accept()}>
              {qa.busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Prisen stemmer
            </Button>
            <Button variant="outline" className="min-h-[44px]" disabled={!canWrite || !item?.rm_id} aria-expanded={fix} onClick={() => setFix((v) => !v)}>Feil pakning</Button>
          </div>
          {item && <AskSupplier item={item} qa={qa} canWrite={canWrite} onDone={(text, caseId) => setDone({ text, undo: null, caseId })} />}
          {!cause.packageSuspect && (cons.falling ?? 0) > 0 && (
            inRound != null
              ? <p className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-success/40 text-sm text-success"><Check className="h-4 w-4" aria-hidden />{inRound} {inRound === 1 ? "vare ligger" : "varer ligger"} i prisrunden</p>
              : <Button variant="outline" className="min-h-[44px]" disabled={!canWrite || cons.items.length === 0} onClick={() => onRound(j.key, cons.items)}>Legg {cons.falling} {cons.falling === 1 ? "vare" : "varer"} i prisrunden</Button>
          )}
          {item && qa.priceStatus === "loading" && <p className="text-caption text-ink-secondary">Kontrollerer prisen …</p>}
          {item && qa.priceStatus === "error" && <p role="alert" className="text-caption text-destructive">Prisen kunne ikke kontrolleres. <button type="button" className="underline" onClick={() => qa.retrySafety()}>Prøv igjen</button></p>}
          {item && qa.priceStatus === "ready" && qa.rows.length === 0 && <p className="text-caption text-ink-secondary">Prisen kan ikke godtas her: {qa.blocked[0]?.label ?? "linjene må kontrolleres på fakturaen"}.</p>}
          {qa.error && <p role="alert" className="text-caption text-destructive">{qa.error}</p>}
        </div>
      </div>
      {itemLimit && <div className="mt-2"><ItemLimitSelect rawMaterialId={j.rawMaterialId} current={itemLimit.current} companyLimit={itemLimit.companyLimit} /></div>}
      {fix && item && (
        <div className="mt-3">
          <PackageFix item={item} lines={lines} canWrite={canWrite} onCancel={() => setFix(false)}
            onSaved={(d) => { setFix(false); setDone({ text: d.result.title, undo: null }); }} />
        </div>
      )}
    </li>
  );
}
