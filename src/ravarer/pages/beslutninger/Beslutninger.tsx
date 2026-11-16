import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { paths } from "@/ravarer/lib/paths";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { useDecisions, useTodayActivity, DECISION_LIMIT } from "@/ravarer/hooks/useDecisions";
import type { PanelResult } from "../priskontroll/gjore/types";
import { DecisionQueue } from "./DecisionQueue";
import { DecisionPanel, type DecisionCtx } from "./DecisionPanel";
import { ExplainSteps } from "./ExplainSteps";
import { useIsWide } from "./useIsWide";

type Receipt = { question: string; result: PanelResult | null; index: number };

/** Råvarer › Beslutninger (variant B): én kø av spørsmål, eldste faktura øverst. */
export default function Beslutninger() {
  const [sp, setSp] = useSearchParams();
  const wide = useIsWide();
  const { work, decisions, openCount, extraCount, truncated } = useDecisions();
  const today = useTodayActivity();
  const valgt = sp.get("valgt");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const lastIndex = useRef(0);

  const select = (key: string | null, push = true) => {
    setReceipt(null);
    setSp((prev) => { const n = new URLSearchParams(prev); if (key) n.set("valgt", key); else n.delete("valgt"); return n; }, { replace: !push });
  };
  const idx = decisions.findIndex((d) => d.key === valgt);
  const sel = idx >= 0 ? decisions[idx] : null;
  if (idx >= 0) lastIndex.current = idx;

  // Bred skjerm: velg første spørsmål når ingenting er valgt.
  useEffect(() => {
    if (wide && !valgt && !receipt && decisions.length > 0) select(decisions[0].key, false);
  }, [wide, valgt, receipt, decisions]); // eslint-disable-line react-hooks/exhaustive-deps -- bare ved nye data

  const next = () => {
    const i = Math.min(lastIndex.current + (sel ? 1 : 0), decisions.length - 1);
    const n = decisions[i] && decisions[i].key !== valgt ? decisions[i] : decisions.find((d) => d.key !== valgt) ?? null;
    select(n?.key ?? null, false);
  };
  // Retur fra fakturasiden tilbake til samme spørsmål (trygg appsti, se fakturaReturn).
  const retur = `${paths.beslutninger()}${sp.toString() ? `?${sp.toString()}` : ""}`;
  const ctx: DecisionCtx = {
    onDone: (r) => setReceipt({ question: sel?.question ?? "", result: r, index: lastIndex.current }),
    onNext: next, onSkip: next, retur,
  };

  const title = openCount == null ? "Beslutninger" : openCount === 0 && extraCount === 0 ? "Alt er besvart" : `Du har ${openCount} ${openCount === 1 ? "spørsmål" : "spørsmål"} å svare på`;
  const tiles = (
    <div className="grid grid-cols-3 gap-2">
      <Tile label="Venter på deg" value={openCount} />
      <Tile label="Linjer løst i dag" value={today.linesSolved} />
      <Tile label="Fakturaer frigjort" value={today.invoicesReleased} />
    </div>
  );

  const showList = wide || !valgt;
  const showPanel = wide || !!valgt;

  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title={title} compact
      subtitle="Systemet har gjort resten. Eldste faktura ligger alltid øverst. Hvert svar gjelder alle fakturaer med samme vare.">
      <div className="space-y-4 px-page pb-8">
        {tiles}
        <ExplainSteps />
        <QueryState isLoading={work.isLoading} isError={work.isError} error={work.error} scope="ravarer:beslutninger" onRetry={() => void work.refetch()}>
          {decisions.length === 0 ? (
            <div className="rounded-2xl border border-line-subtle bg-card p-8 text-center">
              <h2 className="font-serif text-title">Alt er besvart</h2>
              <p className="mt-1 text-body text-ink-secondary">Det finnes ingen åpne spørsmål. Nye fakturaer leses automatisk.</p>
              <Button asChild variant="outline" className="mt-4 min-h-[44px]"><Link to={paths.priskontroll()}>Se fakturaene</Link></Button>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(20rem,26rem)_1fr]">
              {showList && (
                <div className="space-y-2">
                  {extraCount > 0 && <p className="text-caption text-ink-secondary">+ {extraCount} spørsmål om råvarene som kjøpes (videresalg, emballasje, allergener).</p>}
                  {truncated && <p className="text-caption text-ink-secondary">Viser de {DECISION_LIMIT} eldste. Resten kommer når disse er besvart.</p>}
                  <DecisionQueue items={decisions} selectedKey={valgt} onSelect={(k) => select(k)} />
                </div>
              )}
              {showPanel && (
                <div className="min-w-0 rounded-2xl border border-line-subtle bg-card p-4 md:p-5 xl:sticky xl:top-2 xl:self-start">
                  {!wide && (
                    <Button variant="ghost" className="mb-2 min-h-[44px] gap-1" onClick={() => select(null)}><ChevronLeft className="h-4 w-4" aria-hidden />Alle spørsmål</Button>
                  )}
                  {receipt && <ReceiptBox r={receipt} onNext={next} canNext={decisions.some((d) => d.key !== valgt)} />}
                  {sel ? <DecisionPanel key={sel.key} d={sel} ctx={ctx} />
                    : !receipt && <p className="text-body text-ink-secondary">Velg et spørsmål i listen.</p>}
                </div>
              )}
            </div>
          )}
        </QueryState>
      </div>
    </ModulePage>
  );
}

function Tile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-line-subtle bg-card px-3 py-2">
      <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">{label}</p>
      <p className="font-serif text-title tabular-nums">{value == null ? "–" : value.toLocaleString("nb-NO")}</p>
    </div>
  );
}

function ReceiptBox({ r, onNext, canNext }: { r: Receipt; onNext: () => void; canNext: boolean }) {
  return (
    <div role="status" className="mb-4 rounded-xl border border-line-subtle bg-muted/40 p-3">
      <p className="text-body font-semibold">Besvart{r.result?.title ? `: ${r.result.title}` : ""}</p>
      {r.question && <p className="text-caption text-ink-secondary">{r.question}</p>}
      {r.result?.items.length ? <ul className="mt-1 list-disc pl-5 text-caption">{r.result.items.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canNext && <Button className="min-h-[44px]" onClick={onNext}>Neste spørsmål</Button>}
        {r.result?.link && <Button asChild variant="outline" className="min-h-[44px]"><Link to={r.result.link.to}>{r.result.link.label}</Link></Button>}
      </div>
    </div>
  );
}
