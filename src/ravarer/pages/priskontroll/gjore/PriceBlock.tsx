import { useConfirmMany } from "@/ravarer/ui/useConfirmMany";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { firstCostLinesByInvoice, firstCostReport } from "./firstCost";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useMatchTolerances, DEFAULT_HARD_CAP_PCT } from "@/fakturaer/hooks/useMatchTolerances";
import { isOpenLine } from "@/fakturaer/lib/linkFormLogic";
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { StartPriceDialog } from "@/fakturaer/components/StartPriceDialog";
import { NewAgreementDialog } from "@/ravarer/components/NewAgreementDialog";
import { useAcceptSupplierItemPrice } from "@/ravarer/hooks/useWorkData";
import { osloTodayISO } from "@/lib/osloDate";
import { formatDate } from "@/fakturaer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { PriceBlockView, type BlockedRow, type PriceRow } from "./PriceBlockView";
import { useInvoicePriceSafety } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { priceDirection } from "@/fakturaer/lib/priceSafety";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";
import { planClaim, type ClaimPlan } from "@/ravarer/lib/supplierClaim";
import { fetchClaimPreview } from "@/ravarer/hooks/useClaimPreview";
import { ClaimCreditDialog, type ClaimForm } from "./ClaimCreditDialog";
import { useClaimCredit, useRematchInvoices } from "./useGjoreMutations";
import { acceptResultTitle, claimFailureMessage, kr, priceChange, skipLineText } from "./logic";
import type { PanelResult } from "./types";

const START_REASONS = ["start_price_manual_check", "no_automatic_basis", "no_baseline"];

/** Åpne, ikke-førte linjer som kan ha prisarbeid. Bare kandidater — serveren avgjør om de kan sammenlignes. */
export function priceCandidates(lines: SupplierItemLine[]): SupplierItemLine[] {
  return lines.filter((l) => isOpenLine(l) && !l.cost_posted);
}

/** Deler kandidater i serverkontrollerte prisavvik og linjer som ikke kan sammenlignes. */
type GateLine = Pick<SupplierItemLine, "id" | "invoice_id" | "invoice_number" | "invoice_date" | "quantity" | "unit">;
export function splitByGate<L extends GateLine>(cands: L[], gateOf: (l: L) => PriceGate): { rows: PriceRow[]; blocked: BlockedRow[] } {
  const rows: PriceRow[] = [];
  const blocked: BlockedRow[] = [];
  for (const l of cands) {
    const g = gateOf(l);
    const base = { id: l.id, invoice_id: l.invoice_id, invoice_number: l.invoice_number, invoice_date: l.invoice_date };
    if (!g.ok) { blocked.push({ ...base, label: g.label, detail: g.detail }); continue; }
    const s = g.safety;
    if (s.price_per_base_unit == null || s.expected_price_per_base_unit == null || s.effect_nok == null || priceDirection(s) === "same") continue;
    rows.push({ ...base, quantity: l.quantity, unit: l.unit, price_per_base_unit: s.price_per_base_unit, expected_price_per_base_unit: s.expected_price_per_base_unit, base_quantity: s.base_quantity, effect_nok: s.effect_nok, reference_source: s.reference_source, reference_id: s.reference_id });
  }
  return { rows, blocked };
}

export function startPriceLine(lines: SupplierItemLine[]): SupplierItemLine | null {
  return lines.find((l) => isOpenLine(l) && START_REASONS.some((r) => (l.review_reason ?? "").includes(r))) ?? null;
}

/** Om varekortet skal vise prisblokken (ikke en sertifisering av prisavvik). */
export function hasPriceWork(item: SupplierItem, lines: SupplierItemLine[]): boolean {
  return item.status === "prisavvik" || priceCandidates(lines).some((l) => l.price_per_base_unit != null && l.expected_price_per_base_unit != null && Math.abs(l.price_per_base_unit - l.expected_price_per_base_unit) >= 0.005) || !!startPriceLine(lines);
}

type Props = {
  item: SupplierItem;
  lines: SupplierItemLine[];
  canWrite: boolean;
  onDone: (r: PanelResult) => void;
  onCheckPackage: () => void;
};

export function PriceBlock({ item, lines, canWrite, onDone, onCheckPackage }: Props) {
  const { data: company } = useCompany();
  const tol = useMatchTolerances(company?.id ?? null);
  const cands = useMemo(() => priceCandidates(lines), [lines]);
  const accept = useAcceptSupplierItemPrice();
  const claim = useClaimCredit();
  const rematch = useRematchInvoices();
  // Én autoritativ statusforespørsel per bidragende faktura (begrenset samtidighet i hooken).
  const safety = useInvoicePriceSafety(cands.map((l) => l.invoice_id), { pending: accept.isPending || claim.isPending });
  const { rows, blocked } = splitByGate(cands, (l) => safety.gateFor({ id: l.id, invoice_id: l.invoice_id }));
  const status: "ready" | "loading" | "error" = cands.length === 0 || safety.allFresh ? "ready" : safety.anyError ? "error" : "loading";
  // Ingen linjer er valgt på forhånd; valg som ikke lenger er kontrollert faller bort.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => new Set(rows.filter((r) => picked.has(r.id)).map((r) => r.id)), [rows, picked]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorReasons, setErrorReasons] = useState<string[]>([]);
  const [plan, setPlan] = useState<Extract<ClaimPlan, { ok: true }> | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const startLine = startPriceLine(lines);
  const chosen = status === "ready" ? rows.filter((r) => selected.has(r.id)) : [];
  // Referansedato bare når alle valgte linjer har samme grunnlag.
  const refLine = chosen.length > 0 && new Set(chosen.map((r) => `${r.reference_source}|${r.reference_id}`)).size === 1 ? chosen[0] : null;
  // Referansedatoen finnes på fakturalinjen, men ikke i varekortets linjeliste.
  const refDate = useQuery({
    queryKey: ["price-reference-date", refLine?.id ?? null],
    enabled: !!refLine,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_lines").select("price_reference_date").eq("id", refLine!.id).maybeSingle();
      if (error) throw error;
      return data?.price_reference_date ?? null;
    },
  });

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const lineRefs = chosen.map((r) => ({ id: r.id, price_per_base_unit: r.price_per_base_unit }));

  const many = useConfirmMany();
  const qc = useQueryClient();
  const firstCost = useMemo(() => firstCostLinesByInvoice(item, lines), [item, lines]);
  const [fcBusy, setFcBusy] = useState<{ done: number; total: number } | null>(null);
  const runFirstCost = async () => {
    const entries = [...firstCost.entries()];
    setFcBusy({ done: 0, total: entries.length });
    const results: { posted: number; error: string | null }[] = [];
    try {
      for (const [invoiceId, lineIds] of entries) {
        const [r] = await postSafeCosts([invoiceId], lineIds);
        results.push(r ?? { posted: 0, error: "Føringen ble avvist" });
        setFcBusy({ done: results.length, total: entries.length });
      }
    } finally {
      setFcBusy(null);
      for (const [invoiceId] of entries) invalidateInvoice(qc, invoiceId);
      invalidateRawMaterial(qc, item.rm_id ?? undefined);
    }
    onDone(firstCostReport(results));
  };
  const onAccept = async () => {
    setError(null); setErrorReasons([]);
    try {
      const r = await accept.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: lineRefs, reason: reason.trim() || null });
      if (r.accepted === 0) {
        const why = [...new Set(r.skipped_lines.map(skipLineText))];
        setError(`Ingen linjer ble godtatt${why.length ? `: ${why.join("; ")}` : "."}`);
        return;
      }
      onDone({ title: acceptResultTitle(r.accepted, r.invoices.length), items: r.skipped_lines.map(skipLineText) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke godta prisen.");
    }
  };

  // Serveren kontrollerer nøyaktig de valgte linjene og avgjør krav eller prisforespørsel.
  const onCase = async () => {
    setError(null); setErrorReasons([]); setClaimError(null);
    // Bare dyrere linjer går til leverandørsak; lavere priser står igjen til egen vurdering.
    const ids = priceChange(chosen)?.positiveIds ?? [];
    setPreviewing(true);
    try {
      const preview = await fetchClaimPreview(ids);
      const pl = planClaim(preview);
      if (!pl.ok) { setError(pl.message); setErrorReasons(pl.reasons); return; }
      setPlan(pl);
    } catch (e) {
      console.error("[claim-preview]", e);
      setError("Linjene kunne ikke kontrolleres. Prøv igjen.");
    } finally {
      setPreviewing(false);
    }
  };

  const onClaim = async (f: ClaimForm) => {
    if (!plan) return;
    setClaimError(null);
    try {
      const r = await claim.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: plan.lines, title: f.title.trim(), reason: f.reason.trim() || null, followUpOn: f.followUpOn || null });
      if (!r.ok) { setClaimError(claimFailureMessage(r.reason, r.skipped)); return; }
      const kind = r.caseKind ?? plan.kind;
      setPlan(null);
      onDone({
        title: kind === "documented_claim" ? `Krav opprettet (${kr(plan.amount)} eks. mva) · fakturaen kan avstemmes` : "Prisforespørsel opprettet · fakturaen kan avstemmes",
        items: r.skipped.map(skipLineText),
        link: r.caseId ? { to: paths.sak(r.caseId), label: "Åpne leverandørsaken" } : undefined,
      });
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Saken kunne ikke opprettes.");
    }
  };

  const invoiceIds = [...new Set(cands.map((r) => r.invoice_id))];
  const name = item.rm_name ?? item.description ?? "vare";

  return (
    <>
      {rows.length > 0 || blocked.length > 0 || status !== "ready" ? (
        <PriceBlockView
          rows={rows} blocked={blocked} status={status} onRetry={safety.refetch} selected={selected} onToggle={toggle} baseUnit={item.rm_base_unit}
          referenceDate={refDate.data ?? null}
          hasAgreement={item.agreed_price_per_base_unit != null}
          tolerancePct={tol.toleranceFor(item.rm_category)} hardCapPct={tol.settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT} settings={tol.settings}
          reason={reason} onReason={setReason} canWrite={canWrite} busy={accept.isPending || claim.isPending || previewing} error={error} errorReasons={errorReasons}
          onAccept={() => many.guard(lineRefs.length, "Godta prisen", () => void onAccept())} onCase={() => void onCase()}
          onFixAgreement={() => setAgreementOpen(true)} onCheckPackage={onCheckPackage}
          startPrice={startLine ? { onConfirm: () => setStartOpen(true) } : null}
        />
      ) : startLine ? (
        <div className="space-y-2 text-sm">
          <p>Varen mangler prisgrunnlag. Bekreft første kostpris fra siste faktura.</p>
          <button type="button" className="text-primary underline underline-offset-2 disabled:opacity-50" disabled={!canWrite} onClick={() => setStartOpen(true)}>Bekreft startpris</button>
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Ingen åpne linjer har kontrollert prisavvik.</p>
      )}

      {firstCost.size > 1 && (
        <div className="mt-3 space-y-1 rounded-lg border border-border p-3 text-sm">
          <p>Varen mangler kostpris og har trygge linjer på {firstCost.size} fakturaer.</p>
          <button type="button" className="text-primary underline underline-offset-2 disabled:opacity-50" disabled={!canWrite || !!fcBusy} onClick={() => void runFirstCost()}>
            {fcBusy ? `Fører … ${fcBusy.done} av ${fcBusy.total}` : `Før første kostpris på ${firstCost.size} fakturaer`}
          </button>
          {!canWrite && <p className="text-caption text-ink-secondary">Krever skrivetilgang til fakturaer.</p>}
        </div>
      )}
      {rematch.isSuccess && (
        <p role="status" className="mt-2 text-caption text-ink-secondary">{rematch.data.queued} fakturaer lagt i kø for ny beregning.</p>
      )}
      {invoiceIds.length > 0 && canWrite && (
        <button type="button" className="mt-2 text-caption text-primary underline underline-offset-2" disabled={rematch.isPending} onClick={() => rematch.mutate(invoiceIds)}>
          Beregn på nytt ({invoiceIds.length} {invoiceIds.length === 1 ? "faktura" : "fakturaer"})
        </button>
      )}

      <ClaimCreditDialog
        open={!!plan} onOpenChange={(v) => { if (!v) setPlan(null); }} kind={plan?.kind ?? null} amount={plan?.amount ?? null} observed={plan?.observed ?? null} lineCount={plan?.lines.length ?? 0}
        defaultTitle={`${plan?.kind === "documented_claim" ? "Krav" : "Prisforespørsel"} ${name} ${formatDate(osloTodayISO())}`}
        busy={claim.isPending} error={claimError} onSubmit={(f) => void onClaim(f)}
      />
      {agreementOpen && (
        <NewAgreementDialog open={agreementOpen} onOpenChange={setAgreementOpen} defaultRawMaterialId={item.rm_id ?? undefined} defaultSupplierId={item.supplier_id} />
      )}
      {startLine && (
        <StartPriceDialog
          open={startOpen} onOpenChange={setStartOpen} invoiceLineId={startLine.id} description={startLine.description}
          rawMaterialName={item.rm_name} supplierName={item.supplier_name} canWrite={canWrite}
        />
      )}
      {many.dialog}
    </>
  );
}
