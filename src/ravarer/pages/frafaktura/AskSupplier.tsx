import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { osloTodayISO } from "@/lib/osloDate";
import { formatDate } from "@/fakturaer/lib/constants";
import type { SupplierItem } from "@/fakturaer/lib/supplierItems";
import { paths } from "@/ravarer/lib/paths";
import { DuplicateCaseNotice } from "@/ravarer/pages/priskontroll/saker/CaseRecovery";
import { ClaimCreditDialog, type ClaimForm } from "@/ravarer/pages/priskontroll/gjore/ClaimCreditDialog";
import { useClaimFlow } from "@/ravarer/pages/priskontroll/gjore/useClaimFlow";
import { useClaimCredit } from "@/ravarer/pages/priskontroll/gjore/useGjoreMutations";
import { claimFailureMessage, kr, priceChange } from "@/ravarer/pages/priskontroll/gjore/logic";
import type { useQuickAnswers } from "@/ravarer/pages/beslutninger/useQuickAnswers";

type Qa = ReturnType<typeof useQuickAnswers>;

/**
 * «Spør leverandøren» fra Prishopp-raden (leverandørsaker flyttet fra Fakturaer, opprydding demo D).
 * Samme forhåndskontroll og skrivevei som før: prisforespørsel eller dokumentert krav, alltid som utkast til Henrik.
 */
export function AskSupplier({ item, qa, canWrite, onDone }: { item: SupplierItem; qa: Qa; canWrite: boolean; onDone: (text: string, caseId: string | null) => void }) {
  const flow = useClaimFlow();
  const claim = useClaimCredit();
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const plan = flow.state.plan;
  const busy = qa.busy || claim.isPending || previewing;

  const start = async () => {
    setError(null);
    const ids = priceChange(qa.rows)?.positiveIds ?? [];
    if (ids.length === 0) { setError("Ingen linjer har høyere pris enn forrige kjøp eller avtale."); return; }
    setPreviewing(true);
    try { const bad = await flow.start(ids); if (bad) setError(bad.message); }
    catch { setError("Linjene kunne ikke kontrolleres. Prøv igjen."); }
    finally { setPreviewing(false); }
  };
  const submit = async (f: ClaimForm) => {
    if (!plan) return;
    setError(null);
    try {
      const r = await claim.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: plan.lines, title: f.title.trim(), reason: f.reason.trim() || null, followUpOn: f.followUpOn || null });
      if (!r.ok) { setError(claimFailureMessage(r.reason, r.skipped)); return; }
      const kind = r.caseKind ?? plan.kind;
      flow.close();
      setCaseId(r.caseId ?? null);
      onDone(kind === "documented_claim" ? `Kreditnotaforslag laget (${kr(plan.amount)} eks. mva) · utkast til Henrik` : `Forespørsel til ${item.supplier_name ?? "leverandøren"} laget · utkast til Henrik`, r.caseId ?? null);
    } catch (e) { setError(await flow.onSubmitError(e)); }
  };

  return (
    <>
      <Button variant="outline" className="min-h-[44px]" disabled={!canWrite || busy || qa.priceStatus !== "ready" || qa.rows.length === 0} onClick={() => void start()}>
        {previewing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Spør leverandøren …
      </Button>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
      {caseId && <Link className="text-caption font-semibold text-primary hover:underline" to={paths.sak(caseId)}>Åpne leverandørsaken</Link>}
      <ClaimCreditDialog
        open={flow.open} onOpenChange={(v) => { if (!v) { flow.close(); setError(null); } }} kind={flow.state.duplicate ? null : plan?.kind ?? null} amount={plan?.amount ?? null} observed={plan?.observed ?? null} lineCount={plan?.lines.length ?? 0}
        defaultTitle={`${plan?.kind === "documented_claim" ? "Krav" : "Prisforespørsel"} ${item.rm_name ?? item.description ?? "vare"} ${formatDate(osloTodayISO())}`}
        busy={claim.isPending} error={error} onSubmit={(f) => void submit(f)}
        stale={!!flow.state.stalePlan} onRecheck={() => { setError(null); void flow.recheck(); }} recheckBusy={flow.state.recheck === "busy"} recheckError={flow.state.recheck === "error"}
        blocked={flow.state.blocked} changes={flow.state.changes}
        notice={flow.state.duplicate ? <DuplicateCaseNotice openCaseId={flow.state.duplicate.openCaseId} supplierId={item.supplier_id} /> : null}
      />
    </>
  );
}
