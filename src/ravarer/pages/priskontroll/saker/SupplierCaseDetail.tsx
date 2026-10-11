import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/common/QueryState";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { setCaseStatus } from "@/fakturaer/lib/supplierCases";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import { fmtNum } from "@/fakturaer/lib/units";
import { labelFor, SUPPLIER_CASE_STATUS_LABELS } from "@/ravarer/lib/labels";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { CaseCreditForm } from "./CaseCreditForm";
import { CaseEmailDraft } from "./CaseEmailDraft";
import { caseKindOf } from "@/fakturaer/lib/supplierCaseDraft";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useSupplierCaseDetail } from "./useSupplierCaseDetail";

const kr = (v: number | null | undefined) => (v == null ? "–" : formatMoney(v, "NOK"));
const per = (v: number | null | undefined, unit: string | null) => (v == null ? "–" : `${fmtNum(v, 2)} kr${unit ? `/${unit}` : ""}`);

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="rounded-lg border border-border bg-card px-3 py-2"><p className="text-caption text-ink-secondary">{k}</p><p className={`font-semibold tabular-nums ${tone ?? ""}`}>{v}</p></div>;
}

/** Saksdetalj — brukes både i panelet på listen og på egen side. */
export function SupplierCaseDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useSupplierCaseDetail(id);
  const d = q.data;
  const names = useUserNames([d?.c.responsible_user_id]);
  const rights = useInvoiceRights();
  const [statusNote, setStatusNote] = useState("");
  const status = useMutation({
    mutationFn: (s: "open" | "resolved" | "cancelled") => setCaseStatus(id, s, statusNote),
    onSuccess: async () => {
      invalidateRavarerCounts(qc);
      toast.success("Status lagret");
      setStatusNote("");
      await qc.invalidateQueries({ queryKey: ["supplier-case", id] });
      void qc.invalidateQueries({ queryKey: ["supplier-cases"] });
      void qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] });
      void qc.invalidateQueries({ queryKey: ["audit-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!d) return <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:leverandorsak" onRetry={() => void q.refetch()} isEmpty={!q.isLoading} emptyTitle="Saken finnes ikke">{null}</QueryState>;

  const invoices: [string, string][] = [...new Map(d.lines.map((l) => [l.invoice_id, l.invoice?.invoice_number ?? "Faktura"])).entries()];
  const krav = Math.round(d.lines.reduce((s, l) => s + l.amount_excl_vat, 0) * 100) / 100;
  const kreditert = Math.round(d.credits.reduce((s, c) => s + c.amount_excl_vat, 0) * 100) / 100;
  const kind = caseKindOf(d.lines.map((l) => l.basis.case_kind));
  const observed = d.lines.every((l) => l.basis.observed_effect_excl_vat != null) ? Math.round(d.lines.reduce((s, l) => s + (l.basis.observed_effect_excl_vat ?? 0), 0) * 100) / 100 : null;
  const meta = labelFor(SUPPLIER_CASE_STATUS_LABELS, d.c.status, "Ukjent status");
  const responsible = d.c.responsible_user_id ? names.data?.get(d.c.responsible_user_id) ?? "Ukjent bruker" : null;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={meta.label} tokenVar={meta.tokenVar} />
          <span className="text-caption text-ink-secondary">{d.c.supplier?.name ?? "Ukjent leverandør"}</span>
        </div>
        <h2 className="font-display text-2xl font-semibold">{d.c.title}</h2>
        {d.c.reason && <p className="text-sm text-ink-secondary">{d.c.reason}</p>}
        <p className="text-caption text-ink-secondary">
          Opprettet {formatDate(d.c.created_at)}{responsible && ` · ansvarlig ${responsible}`}{d.c.follow_up_on && ` · oppfølging ${formatDate(d.c.follow_up_on)}`}
        </p>
        <p className="text-sm font-medium">{kind === "documented_claim" ? "Dokumentert krav (avtalepris)" : kind === "price_inquiry" ? "Prisforespørsel — ingen penger kreves" : "Eldre sak uten kontrollert grunnlag"}</p>
        {kind === "price_inquiry" ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat k="Observert prisforskjell" v={observed != null ? kr(observed) : "–"} />
            <Stat k="Kreditert" v={kr(kreditert)} />
          </div>
        ) : (
        <div className="grid grid-cols-3 gap-2">
          <Stat k={kind === "documented_claim" ? "Krav" : "Registrert beløp"} v={kr(krav)} />
          <Stat k="Kreditert" v={kr(kreditert)} />
          <Stat k="Gjenstår" v={kr(Math.round((krav - kreditert) * 100) / 100)} tone={krav - kreditert > 0.005 ? "text-warning" : "text-success"} />
        </div>
        )}
        <p className="text-caption text-ink-secondary">Ingen e-post sendes automatisk. Avtaleprisen endres ikke av saken.</p>
      </header>

      <section className="space-y-2">
        <h3 className="font-semibold">Linjer i saken</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-muted/40 text-caption text-ink-secondary">
              <tr><th className="px-3 py-2 text-left font-medium">Faktura</th><th className="px-3 py-2 text-left font-medium">Vare</th><th className="px-3 py-2 text-right font-medium">Forventet</th><th className="px-3 py-2 text-right font-medium">Fakturert</th><th className="px-3 py-2 text-right font-medium">Mengde</th><th className="px-3 py-2 text-right font-medium">Beløp</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.lines.map((l) => {
                const key = l.line ? supplierItemKey(l.line) : null;
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2"><Link className="text-primary hover:underline" to={paths.faktura(l.invoice_id)}>{l.invoice?.invoice_number ?? "Faktura"}</Link></td>
                    <td className="px-3 py-2">
                      {key ? <Link className="text-primary hover:underline" to={paths.varekort(d.c.supplier_id, key)}>{l.line?.description ?? "Vare"}</Link> : (l.line?.description ?? "Vare")}
                      {l.line?.raw_material?.name && <span className="block text-caption text-ink-secondary">{l.line.raw_material.name}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{per(l.basis.expected_price_per_base_unit, l.basis.base_unit ?? l.line?.raw_material?.base_unit ?? null)}</td>
                    <td className="px-3 py-2 text-right">{per(l.basis.price_per_base_unit, l.basis.base_unit ?? l.line?.raw_material?.base_unit ?? null)}</td>
                    <td className="px-3 py-2 text-right">{l.basis.base_quantity != null ? `${fmtNum(l.basis.base_quantity, 2)} ${l.basis.base_unit ?? l.line?.raw_material?.base_unit ?? ""}`.trim() : l.line?.quantity != null ? `${fmtNum(Number(l.line.quantity), 2)} ${l.line.unit ?? ""}` : "–"}</td>
                    <td className="px-3 py-2 text-right">{kr(l.amount_excl_vat)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-border text-sm">
          {invoices.map(([invId, no]) => (
            <li key={invId} className="flex justify-between gap-3 py-1.5"><span>{no}</span><span className="tabular-nums">Restavvik {kr(d.remaining.get(invId) ?? 0)} ekskl. mva.</span></li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Kreditfordeling</h3>
        {d.credits.length === 0 ? <p className="text-sm text-ink-secondary">Ingen kreditt fordelt ennå.</p> : (
          <ul className="divide-y divide-border text-sm">
            {d.credits.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-1.5">
                <span>Kreditnota {c.credit?.invoice_number ?? ""} → {invoices.find(([i]) => i === c.invoice_id)?.[1] ?? "faktura"}</span>
                <span className="tabular-nums">{kr(c.amount_excl_vat)} ekskl. mva.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.c.status === "open" && <section className="rounded-lg border border-border p-4"><CaseCreditForm d={d} invoices={invoices} /></section>}

      <section className="space-y-2 rounded-lg border border-border p-4">
        <Label htmlFor={`case-note-${id}`}>Begrunnelse for statusendring</Label>
        <Textarea id={`case-note-${id}`} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {d.c.status === "open" ? (
            <>
              <Button variant="outline" disabled={status.isPending || !statusNote.trim()} onClick={() => status.mutate("resolved")}>Merk som løst</Button>
              <Button variant="ghost" disabled={status.isPending || !statusNote.trim()} onClick={() => status.mutate("cancelled")}>Avbryt saken</Button>
            </>
          ) : (
            <Button variant="outline" disabled={status.isPending || !statusNote.trim()} onClick={() => status.mutate("open")}>Åpne saken igjen</Button>
          )}
        </div>
        {d.c.resolution_note && <p className="text-sm text-ink-secondary">Siste begrunnelse: {d.c.resolution_note}</p>}
      </section>

      <CaseEmailDraft caseId={id} canWrite={rights.canWrite} input={{
        supplier_name: d.c.supplier?.name ?? null, case_title: d.c.title, credited: kreditert, kind,
        lines: d.lines.map((l) => {
          const unit = l.basis.base_unit ?? l.line?.raw_material?.base_unit ?? null;
          return {
            invoice_number: l.invoice?.invoice_number ?? null, invoice_date: l.invoice?.invoice_date ?? null,
            item: l.line?.raw_material?.name ?? l.line?.description ?? "Vare",
            quantity: l.basis.base_quantity ?? null, unit,
            expected: l.basis.expected_price_per_base_unit ?? null, invoiced: l.basis.price_per_base_unit ?? null,
            amount_excl_vat: l.amount_excl_vat, observed_excl_vat: l.basis.observed_effect_excl_vat,
            reference_source: l.basis.price_reference_source, reference_date: l.basis.price_reference_date,
          };
        }),
      }} />

      <section className="space-y-2">
        <h3 className="font-semibold">Historikk</h3>
        <AuditHistory entityId={id} kind="supplier_case" />
      </section>
    </div>
  );
}
