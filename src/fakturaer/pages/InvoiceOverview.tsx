import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { useCompany } from "@/hooks/useCompany";
import { formatMoney } from "@/fakturaer/lib/constants";
import { amountExclVat, approvalBucket, approveMany, blockerLabel, fetchApprovalOverview, revokeInvoiceApproval, summarizeResults, type ApprovalBucket } from "@/fakturaer/lib/approval";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { cn } from "@/lib/utils";
import { paginate, sumByCurrency } from "@/fakturaer/lib/ravarerQueueFilter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const PAGE_SIZE = 25;

const TABS: Array<{ key: ApprovalBucket; label: string }> = [
  { key: "ready", label: "Klare" },
  { key: "waiting", label: "Avventer" },
  { key: "done", label: "Godkjent" },
];

export default function InvoiceOverview() {
  const { data: company } = useCompany();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find((t) => t.key === sp.get("status"))?.key ?? "ready") as ApprovalBucket;
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [supplier, setSupplier] = useState(sp.get("leverandor") ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"approve" | "costs" | "revoke" | null>(null);
  const { canWrite, canApprove } = useInvoiceRights();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<"approve" | "costs" | null>(null);

  const q = useQuery({
    queryKey: ["invoice-approval-overview", company?.id],
    enabled: !!company?.id,
    queryFn: () => fetchApprovalOverview(company!.id),
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const suppliers = useMemo(() => [...new Map(rows.filter((r) => r.supplier_id).map((r) => [r.supplier_id!, r.supplier_name ?? "Ukjent"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "nb")), [rows]);
  const counts = useMemo(() => {
    const c = { ready: 0, waiting: 0, done: 0 };
    rows.forEach((r) => c[approvalBucket(r)]++);
    return c;
  }, [rows]);
  const s = search.trim().toLowerCase();
  const visible = rows.filter((r) => approvalBucket(r) === tab && (!supplier || r.supplier_id === supplier)
    && (!s || r.invoice_number.toLowerCase().includes(s) || (r.supplier_name ?? "").toLowerCase().includes(s)));
  const pg = paginate(visible, page, PAGE_SIZE);
  // Valg gjelder bare synlig side; filter- og sidebytte nullstiller valget.
  const chosenRows = pg.items.filter((r) => selected[r.invoice_id]);
  const chosen = chosenRows.map((r) => r.invoice_id);
  const chosenSums = sumByCurrency(chosenRows);
  const resetScope = () => { setSelected({}); setPage(1); };

  const setTab = (k: ApprovalBucket) => { const n = new URLSearchParams(sp); n.set("status", k); setSp(n, { replace: true }); resetScope(); };
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] }),
    qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] }),
  ]);

  async function approve() {
    setBusy("approve");
    const res = await approveMany(chosen, null);
    setBusy(null);
    const sum = summarizeResults(res);
    const fails = res.filter((r) => !r.ok);
    if (sum.failed) toast.error(`Intern godkjenning: ${sum.text}`, { description: fails.map((f) => `${rows.find((r) => r.invoice_id === f.invoiceId)?.invoice_number}: ${f.message}`).join("\n") });
    else toast.success(`Intern godkjenning: ${sum.text}. Ingen betaling eller Tripletex-attestering er utløst.`);
    setSelected({});
    await refresh();
  }

  async function revoke(id: string) {
    setBusy("revoke");
    try {
      await revokeInvoiceApproval(id, reason.trim());
      toast.success("Godkjenningen er trukket tilbake.");
      setReason("");
      await refresh();
      await qc.invalidateQueries({ queryKey: ["audit-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke trekke tilbake");
    } finally {
      setBusy(null);
    }
  }

  async function postCosts() {
    setBusy("costs");
    const res = await postSafeCosts(chosen);
    setBusy(null);
    const posted = res.reduce((a, r) => a + r.posted, 0);
    const skipped = res.reduce((a, r) => a + r.skipped, 0);
    const failed = res.filter((r) => r.error);
    (failed.length ? toast.error : toast.success)(`Kostpris ført på ${posted} trygge linjer. ${skipped} linjer venter på avklaring.${failed.length ? ` ${failed.length} fakturaer feilet.` : ""}`,
      failed.length ? { description: failed.map((f) => `${rows.find((r) => r.invoice_id === f.invoiceId)?.invoice_number}: ${f.error}`).join("\n") } : undefined);
    await refresh();
  }

  return (
    <div className="px-page py-6 space-y-5">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Fakturaer</h1>
        <p className="text-sm text-ink-secondary">Intern godkjenning i NBhub. Den betaler ikke og sendes ikke til Tripletex. Råvarevalg sperrer ikke godkjenning; manglende beløp, mva, valuta eller leverandør, ukontrollert eller avvikende linjesum, duplikat, mengdefeil og uavklart prisavvik gjør det.</p>
      </header>
      <div role="tablist" aria-label="Status" className="flex gap-1 border-b border-line-subtle">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary font-medium text-primary" : "border-transparent text-ink-secondary")}>
            {t.label} <span className="tabular-nums">({counts[t.key]})</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input aria-label="Søk på fakturanummer eller leverandør" className="pl-8" placeholder="Søk" value={search} onChange={(e) => { setSearch(e.target.value); resetScope(); }} />
        </div>
        <select aria-label="Leverandør" className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={supplier} onChange={(e) => { setSupplier(e.target.value); resetScope(); }}>
          <option value="">Alle leverandører</option>
          {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {tab !== "done" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
          <span aria-live="polite">
            <strong>{chosen.length}</strong> valgt på denne siden
            {chosenSums.length > 0 && ` · ${chosenSums.map((c) => `${formatMoney(c.total, c.currency)} inkl. mva.${c.missing ? ` (${c.missing} uten beløp)` : ""}`).join(" · ")}`}
          </span>
          <span className="flex-1" />
          {tab === "ready" && canApprove && <Button size="sm" disabled={!chosen.length || !!busy} onClick={() => setConfirm("approve")}>{busy === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Godkjenn valgte internt</Button>}
          {tab === "ready" && !canApprove && <span className="text-ink-secondary">Intern godkjenning krever godkjenner- eller admin-rolle.</span>}
          {canWrite && <Button size="sm" variant="outline" disabled={!chosen.length || !!busy} onClick={() => setConfirm("costs")}>{busy === "costs" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Før kostpris for trygge linjer</Button>}
        </div>
      )}
      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "approve" ? `Godkjenne ${chosen.length} fakturaer internt?` : `Føre kostpris for ${chosen.length} fakturaer?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "approve" ? "Dette er intern attestasjon i NBhub. Det utløser ikke betaling og sendes ikke til Tripletex. Serveren kontrollerer hver faktura på nytt." : "Bare trygge linjer føres. Usikre linjer hoppes over og venter på avklaring."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 divide-y divide-line-subtle overflow-y-auto text-sm">
            {chosenRows.map((r) => (
              <li key={r.invoice_id} className="flex justify-between gap-3 py-1.5"><span className="truncate">{r.supplier_name ?? "Ukjent"} · {r.invoice_number}</span><span className="tabular-nums">{formatMoney(r.total_amount, r.currency)}</span></li>
            ))}
          </ul>
          <p className="text-sm font-medium tabular-nums">Sum: {chosenSums.map((c) => `${formatMoney(c.total, c.currency)} inkl. mva.`).join(" · ")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); if (c === "approve") void approve(); else void postCosts(); }}>
              {confirm === "approve" ? "Godkjenn internt" : "Før kostpris"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <QueryState isLoading={q.isLoading || !company} isError={q.isError} error={q.error} scope="fakturaer:oversikt" onRetry={() => q.refetch()} isEmpty={visible.length === 0} emptyTitle="Ingen fakturaer her">
        <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle bg-card">
          {tab !== "done" && (
            <li className="flex items-center gap-3 px-4 py-2 text-sm text-ink-secondary">
              <Checkbox aria-label="Velg denne siden" checked={chosen.length > 0 && chosen.length === pg.items.length}
                onCheckedChange={(v) => setSelected(v ? Object.fromEntries(pg.items.map((r) => [r.invoice_id, true])) : {})} />
              Velg denne siden ({pg.items.length})
            </li>
          )}
          {pg.items.map((r) => {
            const excl = amountExclVat(r.total_amount, r.total_vat);
            return (
              <li key={r.invoice_id} className="flex items-start gap-3 px-4 py-3">
                {tab !== "done" && <Checkbox className="mt-1" aria-label={`Velg faktura ${r.invoice_number}`} checked={!!selected[r.invoice_id]} onCheckedChange={(v) => setSelected((p) => ({ ...p, [r.invoice_id]: !!v }))} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><span className="font-semibold">{r.supplier_name ?? "Ukjent leverandør"}</span> · <Link className="text-primary hover:underline" to={`/ravarer/fakturaer/${r.invoice_id}`}>{r.invoice_number}</Link>{r.is_credit_note && " · kreditnota"}</span>
                    <span className="text-sm tabular-nums">{formatMoney(r.total_amount, r.currency)} inkl. mva. · {formatMoney(excl, r.currency)} ekskl. mva.</span>
                  </div>
                  <p className="text-sm text-ink-secondary">
                    {r.invoice_date ?? "Uten dato"}
                    {r.open_material_lines > 0 && ` · ${r.open_material_lines} råvarevalg åpne (sperrer ikke godkjenning)`}
                    {r.cost_posted_lines > 0 && ` · kostpris ført på ${r.cost_posted_lines} linjer`}
                    {r.approved_at && ` · internt godkjent ${new Date(r.approved_at).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" })}`}
                  </p>
                  {r.blockers.length > 0 && <p className="text-sm text-warning">{r.blockers.map(blockerLabel).join(" · ")}</p>}
                  <button type="button" className="mt-1 text-sm text-primary hover:underline" aria-expanded={openRow === r.invoice_id} onClick={() => { setOpenRow(openRow === r.invoice_id ? null : r.invoice_id); setReason(""); }}>
                    {openRow === r.invoice_id ? "Skjul historikk" : r.approved_at && canApprove ? "Historikk og tilbaketrekking" : "Historikk"}
                  </button>
                  {openRow === r.invoice_id && (
                    <div className="mt-2 space-y-3 rounded-lg bg-muted/30 p-3">
                      <AuditHistory entityId={r.invoice_id} kind="invoice" />
                      {r.approved_at && canApprove && (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[14rem] flex-1 space-y-1">
                            <label htmlFor={`revoke-${r.invoice_id}`} className="text-sm font-medium">Begrunnelse for tilbaketrekking</label>
                            <Input id={`revoke-${r.invoice_id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                          </div>
                          <Button size="sm" variant="outline" disabled={!reason.trim() || !!busy} onClick={() => revoke(r.invoice_id)}>
                            {busy === "revoke" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Trekk tilbake godkjenning
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <nav aria-label="Sider" className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={pg.page <= 1} onClick={() => { setSelected({}); setPage(pg.page - 1); }}>Forrige</Button>
          <span className="tabular-nums text-ink-secondary">{visible.length} fakturaer · side {pg.page} av {pg.pages}</span>
          <Button variant="outline" size="sm" disabled={pg.page >= pg.pages} onClick={() => { setSelected({}); setPage(pg.page + 1); }}>Neste</Button>
        </nav>
      </QueryState>
    </div>
  );
}
