import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { useReviewLines } from "@/fakturaer/hooks/useReviewLines";
import { useCompany } from "@/hooks/useCompany";
import { buildDecisionGroups, materialOptions } from "@/fakturaer/lib/decisionGroups";
import { formatMoney } from "@/fakturaer/lib/constants";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";
import { acceptPriceVariance, canAcceptPriceVariance, rematchLines } from "@/fakturaer/lib/queueActions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const kr = (v: number | null) => (v == null ? "–" : formatMoney(v, "NOK"));

export default function DecisionDetail() {
  const { key = "" } = useParams();
  const groupKey = decodeURIComponent(key);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const q = useReviewLines({ legalEntityId: company?.id ?? null, limit: null });
  const group = useMemo(() => buildDecisionGroups(q.data?.rows ?? []).find((g) => g.key === groupKey), [q.data, groupKey]);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async (msg: string) => {
    await qc.invalidateQueries({ queryKey: ["fakturaer-review-lines"] });
    await qc.invalidateQueries({ queryKey: ["fakturaer-inbox"] });
    toast.success(msg);
    navigate("/ravarer/fakturaer/i-dag");
  };

  async function applyMaterial() {
    if (!group || !choice) return;
    setBusy(true);
    const failed: string[] = [];
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Ikke innlogget");
      const targets = group.shared ? group.lines : group.lines.slice(0, 1);
      for (const line of targets) {
        try {
          // Pakningen bekreftes ikke her: det er bare råvarevalget som huskes.
          await acceptMatch({ line, rawMaterialId: choice, userId: data.user.id, rememberSku: !!line.supplier_sku, skipRematch: true });
        } catch (e) {
          failed.push(`${line.invoice.invoice_number}: ${e instanceof Error ? e.message : "ukjent feil"}`);
        }
      }
      await rematchLines(targets);
      if (failed.length) toast.error(`${failed.length} linje(r) ble ikke lagret`, { description: failed.join("\n") });
      await done(`Råvaren er lagret på ${targets.length - failed.length} linje(r) og huskes for neste import.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre valget");
    } finally {
      setBusy(false);
    }
  }

  async function acceptPrices() {
    if (!group) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const line of group.lines) {
      try {
        await acceptPriceVariance(line);
        ok += 1;
      } catch (e) {
        failed.push(`${line.invoice.invoice_number}: ${e instanceof Error ? e.message : "ukjent feil"}`);
      }
    }
    setBusy(false);
    if (failed.length) toast.error(`${failed.length} linje(r) ble ikke godtatt`, { description: failed.join("\n") });
    await done(`Prisavviket er godtatt denne gangen på ${ok} linje(r). Avtalen er ikke endret.`);
  }

  const first = group?.lines[0];
  const options = group ? materialOptions(group) : [];
  const allPriceOk = !!group && group.lines.every(canAcceptPriceVariance);

  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <Link to="/ravarer/fakturaer/i-dag" className="text-sm text-primary hover:underline">← I dag</Link>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:beslutning" onRetry={() => q.refetch()}
        isEmpty={!group} emptyTitle="Spørsmålet er allerede avklart" emptyDescription="Gå tilbake til I dag for neste beslutning.">
        {group && first && (
          <>
            <header className="space-y-2">
              <p className="text-caption uppercase tracking-wide text-ink-secondary">
                {group.supplierName} · {group.invoiceIds.length === 1 ? "1 faktura" : `${group.invoiceIds.length} fakturaer`}
              </p>
              <h1 className="font-display text-3xl font-semibold">
                {group.kind === "material" ? `Hvilken råvare er dette?` : group.kind === "price" ? "Ett prisavvik. Én beslutning." : "Avklar linjen"}
              </h1>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="rounded-xl border border-line-subtle bg-card p-5 space-y-4">
                {group.kind === "material" && (
                  <>
                    <h2 className="font-semibold">Velg råvare</h2>
                    <div role="radiogroup" aria-label="Råvare" className="space-y-2">
                      {options.length === 0 && <p className="text-sm text-ink-secondary">Ingen forslag. Velg råvare i køen.</p>}
                      {options.map((o) => (
                        <button key={o.id} type="button" role="radio" aria-checked={choice === o.id} onClick={() => setChoice(o.id)}
                          className={cn("flex w-full items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            choice === o.id ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/50")}>
                          <span className={cn("h-4 w-4 rounded-full border", choice === o.id ? "border-4 border-primary" : "border-ink-secondary")} aria-hidden />
                          <span><span className="block font-medium">{o.name}</span><span className="text-sm text-ink-secondary">{o.detail}</span></span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-line-subtle pt-3 text-sm">
                      <p className="flex items-center gap-2 font-medium text-primary"><Brain className="h-4 w-4" aria-hidden />Dette huskes</p>
                      <p>{group.shared ? `${group.supplierName} + varenummer ${group.sku} → valgt råvare.` : "Linjen mangler varenummer, så valget gjelder bare denne linjen."}</p>
                      <p className="mt-1 text-ink-secondary">Pakningen bekreftes separat. Valget godkjenner ikke fakturaen.</p>
                    </div>
                    <Button className="w-full" disabled={!choice || busy} onClick={applyMaterial}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {group.shared ? `Bruk på ${group.lines.length} linje(r) og husk valget` : "Lagre valget"}
                    </Button>
                  </>
                )}

                {group.kind === "price" && (
                  <>
                    <h2 className="font-semibold">{group.description}</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-muted/40 p-3"><p className="text-sm text-ink-secondary">Referanse ({first.price_reference_source ?? "ukjent kilde"}{first.price_reference_date ? `, ${first.price_reference_date}` : ""})</p><p className="text-2xl font-semibold tabular-nums">{kr(group.expectedPerBase)}</p><p className="text-sm text-ink-secondary">per {first.matched_raw_material?.base_unit ?? "grunnenhet"}</p></div>
                      <div className="rounded-lg bg-muted/40 p-3"><p className="text-sm text-ink-secondary">Fakturert</p><p className="text-2xl font-semibold tabular-nums">{kr(group.observedPerBase)}</p><p className="text-sm text-ink-secondary">per {first.matched_raw_material?.base_unit ?? "grunnenhet"}</p></div>
                    </div>
                  </>
                )}

                {(group.kind === "package" || group.kind === "other") && (
                  <p className="text-body">Denne linjen krever pakningsdetaljer som avklares i fakturakøen.</p>
                )}

                <ul className="divide-y divide-line-subtle border-t border-line-subtle text-sm">
                  {group.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                      <Link className="text-primary hover:underline" to={`/ravarer/fakturaer/til-behandling?faktura=${l.invoice_id}`}>{l.invoice.invoice_number}</Link>
                      <span className="text-ink-secondary">{l.quantity ?? "–"} {l.unit ?? ""} × {kr(l.unit_price)} = {kr(l.total_amount)} ekskl. mva.</span>
                    </li>
                  ))}
                </ul>
              </section>

              <aside className="rounded-xl border border-line-subtle bg-card p-5 space-y-3">
                <h2 className="font-semibold">Fra dokumentet</h2>
                <p className="text-caption uppercase tracking-wide text-ink-secondary">Varenummer {first.supplier_sku ?? "mangler"}</p>
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <p className="font-medium">{first.description}</p>
                  <p className="text-sm">{kr(first.unit_price)} per {first.unit ?? "enhet"}{first.price_per_base_unit != null ? ` · ${kr(first.price_per_base_unit)} per ${first.matched_raw_material?.base_unit ?? "grunnenhet"}` : ""}</p>
                </div>
                <p className="text-sm text-ink-secondary">Kilde: {first.invoice.source === "tripletex" ? "Tripletex (tolket fra PDF)" : first.invoice.source ?? "ukjent"}.</p>
                {group.kind === "price" && (
                  <>
                    <div className="rounded-lg bg-warning/10 p-3">
                      <p className="text-sm">Samlet forskjell</p>
                      <p className="text-2xl font-semibold tabular-nums">{group.differenceExclVat != null ? kr(group.differenceExclVat) : "Ukjent"}</p>
                      <p className="text-sm text-ink-secondary">Ekskl. mva. Beregnet fra dokumentert grunnmengde.</p>
                    </div>
                    <Button variant="outline" className="w-full" disabled={busy || !allPriceOk} onClick={acceptPrices}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Godta prisavviket denne gangen
                    </Button>
                    {!allPriceOk && <p className="text-sm text-ink-secondary">Noen linjer har flere åpne punkter og må avklares i køen først.</p>}
                    <p className="text-sm text-ink-secondary">Avtaleprisen endres ikke. Fakturaen godkjennes eller betales ikke automatisk.</p>
                  </>
                )}
                {(group.kind === "package" || group.kind === "other") && (
                  <Button asChild className="w-full"><Link to={`/ravarer/fakturaer/til-behandling?faktura=${first.invoice_id}`}>Åpne i fakturakøen</Link></Button>
                )}
              </aside>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
