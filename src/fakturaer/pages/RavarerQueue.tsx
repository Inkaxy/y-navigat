import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { useReviewLines } from "@/fakturaer/hooks/useReviewLines";
import { useCompany } from "@/hooks/useCompany";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { buildDecisionGroups, DECISION_KIND_LABEL, encodeGroupKey, RAVARE_KINDS, type DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { applyPackageToLines, outcomeNotes, packagePreview } from "@/fakturaer/lib/groupActions";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum, parseDecimal } from "@/fakturaer/lib/units";

function PackageCard({ g, onDone }: { g: DecisionGroup; onDone: () => Promise<void> }) {
  const first = g.lines[0];
  const unit = first.matched_raw_material?.base_unit ?? "grunnenhet";
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const content = parseDecimal(raw);
  const preview = packagePreview(first, content);
  const id = `pkg-${first.id}`;
  async function save() {
    if (content == null) return;
    setBusy(true);
    try {
      const r = await applyPackageToLines(g.lines, content);
      const notes = outcomeNotes(r);
      const desc = [...notes, ...r.outcomes.filter((o) => !o.ok).map((o) => `${o.invoiceNumber}: ${o.message}`)].join("\n") || undefined;
      (r.failed ? toast.error : notes.length ? toast.warning : toast.success)(`Pakning: ${r.text}`, { description: desc });
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre pakningen");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">Råvare: <strong>{first.matched_raw_material?.name ?? "kjent råvare"}</strong> (beholdes). Fra dokumentet: {first.quantity ?? "–"} {first.unit ?? ""} × {formatMoney(first.unit_price, "NOK")} = {formatMoney(first.total_amount, "NOK")} ekskl. mva.{first.package_size ? ` Tolket pakning: ${fmtNum(first.package_size)} ${first.package_unit ?? ""}.` : ""}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={id}>Innhold per {first.unit ?? "pakning"} i {unit}</Label>
          <Input id={id} inputMode="decimal" className="w-40" value={raw} onChange={(e) => setRaw(e.target.value)} />
        </div>
        <Button disabled={busy || content == null || !(content > 0)} onClick={save}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {g.lines.length > 1 ? `Bekreft pakning på ${g.lines.length} linjer` : "Bekreft pakning"}
        </Button>
      </div>
      {preview && (
        <p className="text-sm text-ink-secondary">
          {first.quantity} × {fmtNum(content ?? 0)} = {fmtNum(preview.baseQuantity)} {unit}
          {preview.pricePerBase != null && ` · ${formatMoney(preview.pricePerBase, "NOK")} per ${unit}`}. Andre pakningsvarianter av varen beholdes.
        </p>
      )}
    </div>
  );
}

export default function RavarerQueue() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const q = useReviewLines({ legalEntityId: company?.id ?? null, limit: null });
  const groups = useMemo(() => buildDecisionGroups(q.data?.rows ?? []).filter((g) => RAVARE_KINDS.has(g.kind)), [q.data]);
  const { canWrite } = useInvoiceRights();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all(["fakturaer-review-lines", "invoice-approval-overview", "fakturaer-inbox", "vareminne-links"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };

  async function firstCost(g: DecisionGroup) {
    setBusyKey(g.key);
    const lineIds = g.lines.map((l) => l.id);
    const res = await postSafeCosts(g.invoiceIds, lineIds);
    setBusyKey(null);
    const posted = res.reduce((s, r) => s + r.posted, 0);
    const failed = res.filter((r) => r.error);
    (posted === g.lines.length ? toast.success : toast.error)(`Første kostpris: ${posted} av ${g.lines.length} linjer ført`, failed.length ? { description: failed.map((f) => f.error).join("\n") } : undefined);
    await refresh();
  }

  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Råvarer og kostpris</h1>
        <p className="text-ink-secondary">Bare nye eller endrede spørsmål. Like linjer (samme leverandør, varenummer og pakning) avklares samlet. Valgene her godkjenner ikke fakturaer.</p>
        <Link to="/ravarer/fakturaer/vareminne" className="text-sm text-primary hover:underline">Se lagrede koblinger</Link>
      </header>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:ravarer" onRetry={() => q.refetch()} isEmpty={groups.length === 0} emptyTitle="Ingen råvarespørsmål nå">
        <p className="text-sm text-ink-secondary">{groups.length} spørsmål fra {new Set(groups.flatMap((g) => g.invoiceIds)).size} fakturaer (hele køen er hentet).</p>
        <ol className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-xl border border-line-subtle bg-card p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-caption uppercase tracking-wide text-ink-secondary">{DECISION_KIND_LABEL[g.kind]} · {g.supplierName}{g.sku ? ` · nr. ${g.sku}` : " · uten varenummer"}</p>
                  <h2 className="font-semibold">{g.description}</h2>
                  <p className="text-sm text-ink-secondary">{g.lines.length} linjer på {g.invoiceIds.length} fakturaer</p>
                </div>
                {g.kind === "material" && (
                  <Link to={`/ravarer/fakturaer/i-dag/${encodeGroupKey(g.key)}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Velg råvare <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
                )}
              </div>
              {g.kind === "package" && canWrite && <PackageCard g={g} onDone={refresh} />}
              {!canWrite && g.kind !== "material" && <p className="text-sm text-ink-secondary">Du har lesetilgang og kan ikke lagre valg her.</p>}
              {g.kind === "first_cost" && canWrite && (
                <div className="space-y-2">
                  <p className="text-sm">
                    Ingen avtale- eller startpris finnes. Dokumentert pris: <strong>{g.observedPerBase != null ? formatMoney(g.observedPerBase, "NOK") : "–"}</strong> per {g.lines[0].matched_raw_material?.base_unit ?? "grunnenhet"} ({g.lines[0].invoice.invoice_date}).
                  </p>
                  <Button variant="outline" disabled={busyKey === g.key} onClick={() => firstCost(g)}>
                    {busyKey === g.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Før som første kostpris
                  </Button>
                  <p className="text-sm text-ink-secondary">Føres med kilde og dato. Avtalepris opprettes ikke.</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </QueryState>
    </div>
  );
}
