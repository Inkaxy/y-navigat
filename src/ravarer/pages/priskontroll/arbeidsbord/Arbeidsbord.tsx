import { useEffect, useMemo, useState } from "react";
import { useWorkItems, useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { paths } from "@/ravarer/lib/paths";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { VarekortPanel } from "../gjore/VarekortPanel";
import { FakturasakPanel } from "../gjore/FakturasakPanel";
import { ArbeidsbordView, useArbeidsbordParams } from "./ArbeidsbordView";
import { OriginalPane } from "./OriginalPane";

const PAGE = 50;

/** Priskontroll › Å gjøre (standard): arbeidsbordet med ekte data og eksisterende paneler. */
export function Arbeidsbord() {
  const prm = useArbeidsbordParams();
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [prm.gruppe, prm.sort, prm.q, prm.leverandor]);
  const work = useWorkItems({ group: prm.gruppe, search: prm.q || null, supplierId: prm.leverandor, sort: prm.sort, limit });
  const summary = useWorkSummary({ includeApproval: true });
  const items = useMemo(() => work.data?.items ?? [], [work.data]);

  const classic = new URLSearchParams(prm.sp);
  classic.set("fane", "gjore");
  classic.set("visning", "klassisk");
  classic.delete("del");
  classic.delete("linje");

  const fullHref = (it: WorkItem) => {
    if (it.type === "faktura" && it.invoice_id) {
      const ret = new URLSearchParams(prm.sp);
      ret.delete("valgt");
      ret.delete("del");
      ret.set("fane", "gjore");
      return `${paths.faktura(it.invoice_id)}?retur=${encodeURIComponent(ret.toString())}`;
    }
    return it.supplier_id && it.item_key ? paths.varekort(it.supplier_id, it.item_key) : paths.priskontroll({ fane: "gjore" });
  };

  return (
    <ArbeidsbordView
      items={items}
      total={work.data?.total ?? 0}
      counts={work.data?.counts}
      summary={summary.data}
      loading={work.isLoading}
      isError={work.isError}
      error={work.error}
      onRetry={() => void work.refetch()}
      fetchingMore={work.isFetching && limit > items.length}
      onMore={() => setLimit((n) => n + PAGE)}
      fullHref={fullHref}
      classicHref={`?${classic.toString()}`}
      renderOriginal={(it, onClose) => <OriginalPane key={decisionKey(it)} item={it} onClose={onClose} lineId={it.invoice_id ? null : prm.sp.get("linje")} />}
      renderDecision={(it, ctx) => renderWorkDecision(it, ctx, prm.sp.get("linje"), (id) => prm.set({ linje: id }, false))}
    />
  );
}

type DecisionItem = { type: string; supplier_id?: string | null; item_key?: string | null; invoice_id?: string | null; kind?: string | null };
type DecisionCtx = { onDone: () => void; onNext: () => void; onSkip: () => void };

/** Stabil identitet per beslutning: et annet kort må nullstille lokal tilstand (frosset utvalg, utkast, resultat). */
export function decisionKey(it: DecisionItem): string {
  return it.type === "varekort" && it.supplier_id && it.item_key ? `vk|${it.supplier_id}|${it.item_key}` : it.invoice_id ? `fa|${it.invoice_id}|${it.kind ?? ""}` : `x|${it.type}`;
}

export function renderWorkDecision(it: DecisionItem, ctx: DecisionCtx, linje: string | null, onLine: (id: string) => void) {
  const key = decisionKey(it);
  if (it.type === "varekort" && it.supplier_id && it.item_key)
    return <VarekortPanel key={key} supplierId={it.supplier_id} itemKey={it.item_key} onDone={ctx.onDone} onNext={ctx.onNext} onSkip={ctx.onSkip}
      originalLineId={linje} onOriginalLine={onLine} />;
  if (it.invoice_id) return <FakturasakPanel key={key} invoiceId={it.invoice_id} kind={it.kind as never} onDone={ctx.onDone} onNext={ctx.onNext} onSkip={ctx.onSkip} />;
  return <p key={key} className="text-sm text-ink-secondary">Elementet mangler referanse.</p>;
}
