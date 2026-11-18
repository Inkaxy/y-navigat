// Ikke lest › «Sjekk tallene»: linjer der lesekontrollen ikke stemmer (flyttet fra Beslutninger), og «Sjekk koblingen»:
// automatiske koblinger som må bekreftes. Svarene går gjennom det samme svarpanelet og de samme skriveveiene som før,
// med samme angre. Hentes bare når fanen er åpen (tungt køoppslag).
import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QueryState } from "@/components/common/QueryState";
import { useCompany } from "@/hooks/useCompany";
import { useWorkItems } from "@/ravarer/hooks/useWorkData";
import { decisionsFromWork, solvesText, sortDecisions, type Decision } from "@/ravarer/lib/decisions";
import { saveLastAnswer, type UndoAnswer } from "@/ravarer/lib/quickAnswers";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { DecisionPanel, type DecisionCtx } from "@/ravarer/pages/beslutninger/DecisionPanel";
import { useDecisionUndo } from "@/ravarer/pages/beslutninger/useDecisionUndo";
import type { PanelResult } from "@/ravarer/pages/priskontroll/gjore/types";

const LIMIT = 200;

/** Ren gruppering: lesekontroll («Sjekk tallene») og koblingskontroll («Sjekk koblingen»), eldste først. */
export function checkGroups(ds: readonly Decision[]): { numbers: Decision[]; links: Decision[] } {
  const sorted = sortDecisions(ds);
  return { numbers: sorted.filter((d) => d.type === "kan_ikke_leses"), links: sorted.filter((d) => d.type === "kontroll") };
}

export function CheckNumbersSection({ retur }: { retur: string }) {
  const q = useWorkItems({ group: "kontroll", sort: "oldest", limit: LIMIT });
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const undo = useDecisionUndo();
  const groups = useMemo(() => checkGroups(decisionsFromWork(q.data?.items ?? [])), [q.data]);
  const all = useMemo(() => [...groups.numbers, ...groups.links], [groups]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ question: string; result: PanelResult | null; undo: UndoAnswer | null } | null>(null);
  const sel = all.find((d) => d.key === openKey) ?? null;
  const total = q.data?.total ?? null;
  if (!q.isLoading && !q.isError && all.length === 0 && !receipt) return null;

  const next = () => {
    const i = all.findIndex((d) => d.key === openKey);
    const n = all[i + 1] ?? all.find((d) => d.key !== openKey) ?? null;
    setOpenKey(n?.key ?? null);
  };
  const ctx: DecisionCtx = {
    onDone: (r, u) => {
      undo.reset();
      if (u && company) { saveLastAnswer(company.id, u); undo.refresh(); }
      setReceipt({ question: sel?.question ?? "", result: r, undo: u ?? null });
      setOpenKey(null);
      invalidateRavarerCounts(qc);
    },
    onNext: next, onSkip: next, retur,
  };

  const list = (title: string, id: string, help: string, items: Decision[]) => items.length === 0 ? null : (
    <section aria-labelledby={id} className="border-t border-line-subtle">
      <div className="px-4 py-4 md:px-5">
        <h3 id={id} className="text-body font-semibold">{title} <span className="tabular-nums text-ink-secondary">{items.length.toLocaleString("nb-NO")}</span></h3>
        <p className="text-caption text-ink-secondary">{help}</p>
      </div>
      <ul aria-label={title}>
        {items.map((d) => (
          <li key={d.key} className="grid gap-2 border-t border-line-subtle px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-5">
            <div className="min-w-0">
              <p className="font-medium">{d.question}</p>
              <p className="text-caption text-ink-secondary">{[d.supplierName, solvesText(d)].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="outline" className="min-h-[44px]" onClick={() => { setReceipt(null); setOpenKey(d.key); }}>Se og svar</Button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="mt-3">
      {receipt && (
        <div role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line-subtle bg-muted/40 px-3 py-2 text-sm md:mx-5">
          <span className="min-w-0 flex-1">{receipt.result?.title ?? "Lagret."} {receipt.question && <span className="text-ink-secondary">({receipt.question})</span>}</span>
          {receipt.undo && undo.canUndo(receipt.undo) && (
            <Button size="sm" variant="ghost" className="min-h-[44px] gap-1.5" disabled={undo.state.kind === "busy"} onClick={() => receipt.undo && void undo.undo(receipt.undo)}>
              <Undo2 className="h-4 w-4" aria-hidden />Angre
            </Button>
          )}
        </div>
      )}
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:fra-faktura:sjekk-tallene" onRetry={() => void q.refetch()}>
        {list("Sjekk tallene", "ff-ul-tall", "Linjer der mengde × pris ikke stemmer med summen, eller tallene er usikre. Rett linjen eller bekreft den.", groups.numbers)}
        {list("Sjekk koblingen", "ff-ul-kobling", "Linjer som ble koblet automatisk med middels sikkerhet. Bekreft eller velg riktig vare.", groups.links)}
        {total != null && total > LIMIT && <p className="px-5 pb-3 text-caption text-ink-secondary">Viser de {LIMIT} eldste av {total.toLocaleString("nb-NO")}.</p>}
      </QueryState>
      <Sheet open={sel != null} onOpenChange={(o) => { if (!o) setOpenKey(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{sel?.type === "kontroll" ? "Sjekk koblingen" : "Sjekk tallene"}</SheetTitle></SheetHeader>
          {sel && <div className="mt-4"><DecisionPanel key={sel.key} d={sel} ctx={ctx} /></div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
