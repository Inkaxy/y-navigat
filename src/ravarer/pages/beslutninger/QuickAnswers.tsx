import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/hooks/useCompany";
import { osloTodayISO } from "@/lib/osloDate";
import { formatDate } from "@/fakturaer/lib/constants";
import { callPendingRpc, useCapability } from "@/lib/pendingRpc";
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { useConfirmMany } from "@/ravarer/ui/useConfirmMany";
import { paths } from "@/ravarer/lib/paths";
import { quickAnswersFor, quickLabel, SKIP_REASONS, suggestSkipReason, type QuickKind, type SkipReason } from "@/ravarer/lib/quickAnswers";
import type { DecisionType } from "@/ravarer/lib/decisions";
import { DuplicateCaseNotice } from "@/ravarer/pages/priskontroll/saker/CaseRecovery";
import { ClaimCreditDialog, type ClaimForm } from "../priskontroll/gjore/ClaimCreditDialog";
import { useClaimFlow } from "../priskontroll/gjore/useClaimFlow";
import { useClaimCredit } from "../priskontroll/gjore/useGjoreMutations";
import { claimFailureMessage, kr, priceChange, skipLineText } from "../priskontroll/gjore/logic";
import { PackageFix } from "./PackageFix";
import { useQuickAnswers, type QuickDone } from "./useQuickAnswers";

type Props = {
  type: DecisionType; item: SupplierItem; lines: readonly SupplierItemLine[]; canWrite: boolean; locked: boolean;
  onAnswered: (d: QuickDone) => void; onOpenAll: () => void;
};

/** De 2–3 svarknappene i spørsmålet (B1). Alt annet ligger fortsatt under «Alle valg». */
export function QuickAnswers({ type, item, lines, canWrite, locked, onAnswered, onOpenAll }: Props) {
  const kinds = quickAnswersFor(type, { linked: !!item.rm_id && item.status !== "ukoblet", locked });
  const qa = useQuickAnswers(item, lines);
  const many = useConfirmMany();
  const [mode, setMode] = useState<null | "pakning" | "hopp_alltid" | "hopp_en_gang" | "folgevare">(null);
  const [reason, setReason] = useState<SkipReason>(() => suggestSkipReason(item.description));
  const flow = useClaimFlow();
  const claim = useClaimCredit();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const automatikk = useCapability("rm_cap_automatikk_v1");
  const { data: company } = useCompany();
  const [deposit, setDeposit] = useState<{ count: number } | null>(null);

  if (kinds.length === 0) return null;
  const newest = qa.rows.length ? [...qa.rows].sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? ""))[0] : null;
  const samePrice = qa.rows.every((r) => newest && Math.abs(r.price_per_base_unit - newest.price_per_base_unit) < 0.005);
  const supplier = item.supplier_name ?? null;
  const plan = flow.state.plan;
  const busy = qa.busy || claim.isPending || previewing;
  const priceBlockedText = qa.priceStatus === "loading" ? "Kontrollerer prisene …"
    : qa.priceStatus === "error" ? "Prisstatus kunne ikke hentes."
    : qa.rows.length === 0 && qa.blocked.length > 0 ? `Prisen kan ikke godtas herfra: ${qa.blocked[0].label}.` : null;

  const label = (k: QuickKind) => k === "godta" && newest && !samePrice ? `Ja, godta prisene (${qa.rows.length} linjer)`
    : quickLabel(k, { price: newest?.price_per_base_unit ?? null, unit: newest?.base_unit ?? item.rm_base_unit, date: newest?.invoice_date ?? null, supplier });

  const startCase = async () => {
    qa.setError(null); setClaimError(null);
    const ids = priceChange(qa.rows)?.positiveIds ?? [];
    if (ids.length === 0) { qa.setError("Ingen linjer har høyere pris enn forrige kjøp eller avtale."); return; }
    setPreviewing(true);
    try {
      const bad = await flow.start(ids);
      if (bad) qa.setError(bad.message);
    } catch { qa.setError("Linjene kunne ikke kontrolleres. Prøv igjen."); }
    finally { setPreviewing(false); }
  };
  const submitCase = async (f: ClaimForm) => {
    if (!plan) return;
    setClaimError(null);
    try {
      const r = await claim.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: plan.lines, title: f.title.trim(), reason: f.reason.trim() || null, followUpOn: f.followUpOn || null });
      if (!r.ok) { setClaimError(claimFailureMessage(r.reason, r.skipped)); return; }
      const kind = r.caseKind ?? plan.kind;
      flow.close();
      onAnswered({ result: {
        title: kind === "documented_claim" ? `Kreditnotaforslag laget (${kr(plan.amount)} eks. mva) · utkast til Henrik` : `Forespørsel til ${supplier ?? "leverandøren"} laget · utkast til Henrik`,
        items: r.skipped.map(skipLineText), link: r.caseId ? { to: paths.sak(r.caseId), label: "Åpne leverandørsaken" } : undefined,
      }, undo: null });
    } catch (e) { setClaimError(await flow.onSubmitError(e)); }
  };
  const depositRun = async (dry: boolean) => {
    if (!company) return;
    qa.setError(null);
    const ids = [...new Set(qa.openLines.map((l) => l.invoice_id))];
    const r = await callPendingRpc("rm_mark_deposit_follow_items", { p_legal_entity_id: company.id, p_invoice_ids: ids, p_limit: 200, p_dry_run: dry });
    const marked = r.kind === "ok" && r.data && typeof r.data === "object" && typeof (r.data as { marked?: unknown }).marked === "number" ? (r.data as { marked: number }).marked : null;
    if (r.kind === "missing") { qa.setError("Venter på databaseendringen for Automatikk."); return; }
    if (marked == null) { qa.setError(r.kind === "denied" ? "Du har ikke skrivetilgang til fakturaer." : "Utfallet er ukjent. Kontroller fakturaene før du prøver igjen."); return; }
    if (dry) { setDeposit({ count: marked }); return; }
    onAnswered({ result: { title: `${marked} pantlinjer følger varen (utenfor kost, mva-fri)`, items: [] }, undo: null });
  };

  const click = (k: QuickKind) => {
    qa.setError(null);
    if (k === "godta") { many.guard(qa.rows.length, "Godta prisen", () => void qa.acceptAll().then((d) => d && onAnswered(d))); return; }
    if (k === "spor" || k === "kreditnota") { void startCase(); return; }
    if (k === "velg_ravare") { onOpenAll(); return; }
    if (k === "folgevare") { setMode("folgevare"); void depositRun(true); return; }
    setMode(k);
  };
  const disabled = (k: QuickKind) => !canWrite || busy || ((k === "godta" || k === "spor" || k === "kreditnota") && (qa.priceStatus !== "ready" || qa.rows.length === 0))
    || (k === "folgevare" && automatikk !== true);

  return (
    <section aria-label="Svar" className="space-y-3">
      <div className="flex flex-wrap gap-2" data-testid="svarknapper">
        {kinds.map((k, i) => (
          <Button key={k} variant={i === 0 ? "default" : "outline"} className="min-h-[44px]" disabled={disabled(k)} onClick={() => click(k)}>
            {busy && i === 0 && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{label(k)}
          </Button>
        ))}
      </div>
      {kinds.some((k) => k === "godta") && priceBlockedText && (
        <p className="text-caption text-ink-secondary">{priceBlockedText}{qa.priceStatus === "error" && <> <button type="button" className="underline underline-offset-2" onClick={qa.retrySafety}>Prøv igjen</button></>}</p>
      )}
      {kinds.includes("folgevare") && automatikk === false && <p className="text-caption text-ink-secondary">«Pant følger varen» venter på databaseendringen for Automatikk. Til da kan pantlinjen kobles under «Alle valg». Den skal ikke hoppes over.</p>}
      {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
      {qa.error && <p role="alert" className="text-sm text-destructive">{qa.error}</p>}

      {mode === "pakning" && <PackageFix item={item} lines={lines} canWrite={canWrite} onSaved={onAnswered} onCancel={() => setMode(null)} />}
      {(mode === "hopp_alltid" || mode === "hopp_en_gang") && (
        <div className="space-y-2 rounded-xl border border-line-subtle bg-card p-3">
          <p className="text-sm font-medium">{mode === "hopp_alltid" ? "Hoppes over på alle fakturaer fra leverandøren, også senere." : `Hoppes over på ${qa.openLines.length} ${qa.openLines.length === 1 ? "linje" : "linjer"} nå. Neste gang spør systemet igjen.`}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hva er det?">
            {SKIP_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                className={`min-h-[44px] rounded-full border px-3 text-sm ${reason === r ? "border-primary bg-primary/10 text-primary" : "border-line-subtle"}`}>{r}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-[44px]" disabled={!canWrite || busy} onClick={() => void (mode === "hopp_alltid" ? qa.skipAlways(reason) : qa.skipOnce(reason)).then((d) => d && onAnswered(d))}>
              {mode === "hopp_alltid" ? "Hopp over alltid" : "Hopp over nå"}
            </Button>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => setMode(null)}>Avbryt</Button>
          </div>
        </div>
      )}
      {mode === "folgevare" && deposit && (
        <div className="space-y-2 rounded-xl border border-line-subtle bg-card p-3 text-sm">
          <p>{deposit.count === 0 ? "Ingen pantlinjer på disse fakturaene kan merkes (har allerede pris i historikken, mva er ikke 0, eller fakturaen er låst)." : `${deposit.count} pantlinjer på ${new Set(qa.openLines.map((l) => l.invoice_id)).size} fakturaer følger varen. De holdes utenfor kost og er mva-frie. Ingenting utelates.`}</p>
          <div className="flex flex-wrap gap-2">
            {deposit.count > 0 && <Button className="min-h-[44px]" disabled={!canWrite || busy} onClick={() => void depositRun(false)}>Lagre</Button>}
            <Button variant="ghost" className="min-h-[44px]" onClick={() => { setMode(null); setDeposit(null); }}>Avbryt</Button>
          </div>
        </div>
      )}
      <ClaimCreditDialog
        open={flow.open} onOpenChange={(v) => { if (!v) { flow.close(); setClaimError(null); } }} kind={flow.state.duplicate ? null : plan?.kind ?? null} amount={plan?.amount ?? null} observed={plan?.observed ?? null} lineCount={plan?.lines.length ?? 0}
        defaultTitle={`${plan?.kind === "documented_claim" ? "Krav" : "Prisforespørsel"} ${item.rm_name ?? item.description ?? "vare"} ${formatDate(osloTodayISO())}`}
        busy={claim.isPending} error={claimError} onSubmit={(f) => void submitCase(f)}
        stale={!!flow.state.stalePlan} onRecheck={() => { setClaimError(null); void flow.recheck(); }} recheckBusy={flow.state.recheck === "busy"} recheckError={flow.state.recheck === "error"}
        blocked={flow.state.blocked} changes={flow.state.changes}
        notice={flow.state.duplicate ? <DuplicateCaseNotice openCaseId={flow.state.duplicate.openCaseId} supplierId={item.supplier_id} /> : null}
      />
      {many.dialog}
    </section>
  );
}
