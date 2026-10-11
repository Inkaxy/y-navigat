import { useConfirmMany } from "@/ravarer/ui/useConfirmMany";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { PriceBlockView, type PriceRow } from "./PriceBlockView";
import { ClaimCreditDialog, type ClaimForm } from "./ClaimCreditDialog";
import { useClaimCredit, useRematchInvoices } from "./useGjoreMutations";
import { acceptResultTitle, claimAmount, claimFailureMessage, kr, skipLineText } from "./logic";
import type { PanelResult } from "./types";

const START_REASONS = ["start_price_manual_check", "no_automatic_basis", "no_baseline"];

/** Åpne linjer med en kjent pris som avviker fra forventet (og som ikke er ført). */
export function priceRows(lines: SupplierItemLine[]): PriceRow[] {
  return lines.flatMap((l) => {
    if (!isOpenLine(l) || l.cost_posted) return [];
    const a = l.price_per_base_unit;
    const e = l.expected_price_per_base_unit;
    if (a == null || e == null || e <= 0 || Math.abs(a - e) < 0.005) return [];
    return [{
      id: l.id, invoice_id: l.invoice_id, invoice_number: l.invoice_number, invoice_date: l.invoice_date,
      quantity: l.quantity, unit: l.unit, price_per_base_unit: a, expected_price_per_base_unit: e, base_quantity: l.base_quantity,
    }];
  });
}

export function startPriceLine(lines: SupplierItemLine[]): SupplierItemLine | null {
  return lines.find((l) => isOpenLine(l) && START_REASONS.some((r) => (l.review_reason ?? "").includes(r))) ?? null;
}

export function hasPriceWork(item: SupplierItem, lines: SupplierItemLine[]): boolean {
  return item.status === "prisavvik" || priceRows(lines).length > 0 || !!startPriceLine(lines);
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
  const rows = useMemo(() => priceRows(lines), [lines]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const accept = useAcceptSupplierItemPrice();
  const claim = useClaimCredit();
  const rematch = useRematchInvoices();
  const startLine = startPriceLine(lines);
  const chosen = rows.filter((r) => selected.has(r.id));
  const refLine = lines.find((l) => l.id === chosen[0]?.id) ?? null;
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

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const lineRefs = chosen.map((r) => ({ id: r.id, price_per_base_unit: r.price_per_base_unit }));

  const many = useConfirmMany();
  const onAccept = async () => {
    setError(null);
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

  const onClaim = async (f: ClaimForm) => {
    setClaimError(null);
    try {
      const r = await claim.mutateAsync({ supplierId: item.supplier_id, itemKey: item.item_key, lines: lineRefs, title: f.title.trim(), reason: f.reason.trim() || null, followUpOn: f.followUpOn || null });
      if (!r.ok) { setClaimError(claimFailureMessage(r.reason, r.skipped)); return; }
      setClaimOpen(false);
      onDone({
        title: `Sak opprettet (${r.amount != null ? kr(r.amount) : `ca. ${kr(claimAmount(chosen))}`}) · fakturaen kan avstemmes`,
        items: r.skipped.map(skipLineText),
        link: r.caseId ? { to: paths.sak(r.caseId), label: "Åpne leverandørsaken" } : undefined,
      });
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Kravet kunne ikke opprettes.");
    }
  };

  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id))];
  const name = item.rm_name ?? item.description ?? "vare";

  return (
    <>
      {rows.length > 0 ? (
        <PriceBlockView
          rows={rows} selected={selected} onToggle={toggle} baseUnit={item.rm_base_unit}
          referenceSource={refLine?.price_reference_source ?? null} referenceDate={refDate.data ?? null}
          hasAgreement={item.agreed_price_per_base_unit != null}
          tolerancePct={tol.toleranceFor(item.rm_category)} hardCapPct={tol.settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT} settings={tol.settings}
          reason={reason} onReason={setReason} canWrite={canWrite} busy={accept.isPending || claim.isPending} error={error}
          onAccept={() => many.guard(lineRefs.length, "Godta prisen", () => void onAccept())} onClaim={() => many.guard(lineRefs.length, "Krev kreditt", () => setClaimOpen(true))}
          onFixAgreement={() => setAgreementOpen(true)} onCheckPackage={onCheckPackage}
          startPrice={startLine ? { onConfirm: () => setStartOpen(true) } : null}
        />
      ) : startLine ? (
        <div className="space-y-2 text-sm">
          <p>Varen mangler prisgrunnlag. Bekreft første kostpris fra siste faktura.</p>
          <button type="button" className="text-primary underline underline-offset-2 disabled:opacity-50" disabled={!canWrite} onClick={() => setStartOpen(true)}>Bekreft startpris</button>
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">Ingen åpne linjer har prisavvik.</p>
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
        open={claimOpen} onOpenChange={setClaimOpen} amount={claimAmount(chosen)}
        defaultTitle={`Prisøkning ${name} ${formatDate(osloTodayISO())}`}
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
