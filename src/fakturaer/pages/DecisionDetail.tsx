import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PackageDecision } from "@/fakturaer/components/decisions/PackageDecision";
import { FirstCostDecision } from "@/fakturaer/components/decisions/FirstCostDecision";
import { filterRavarerGroups, nextGroupKey, parseRavarerFilter } from "@/fakturaer/lib/ravarerQueueFilter";
import { encodeGroupKey } from "@/fakturaer/lib/decisionGroups";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { DecisionNav } from "@/fakturaer/components/decisions/DecisionNav";
import { useReviewLines } from "@/fakturaer/hooks/useReviewLines";
import { useCompany } from "@/hooks/useCompany";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { buildDecisionGroups, materialOptions } from "@/fakturaer/lib/decisionGroups";
import { formatMoney } from "@/fakturaer/lib/constants";
import { applyMaterialToLines, filterUnchanged, outcomeNotes, runPerLine, type GroupOutcome } from "@/fakturaer/lib/groupActions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import type { DecisionGroup } from "@/fakturaer/lib/decisionGroups";
import { createSupplierCase } from "@/fakturaer/lib/supplierCases";
import { acceptPriceVariance, canAcceptPriceVariance } from "@/fakturaer/lib/queueActions";
import { cn } from "@/lib/utils";

const kr = (v: number | null) => (v == null ? "–" : formatMoney(v, "NOK"));

export default function DecisionDetail() {
  const { key = "" } = useParams();
  // useParams er allerede dekodet; ny dekoding krasjer på %-tegn i varenummer.
  const groupKey = key;
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const fromRavarer = sp.get("fra") === "ravarer";
  const backParams = new URLSearchParams(sp); backParams.delete("fra");
  const backHref = fromRavarer ? `/ravarer/fakturaer/ravarer${backParams.toString() ? `?${backParams}` : ""}` : "/ravarer/fakturaer/i-dag";
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const q = useReviewLines({ legalEntityId: company?.id ?? null, limit: null });
  const live = useMemo(() => buildDecisionGroups(q.data?.rows ?? []).find((g) => g.key === groupKey), [q.data, groupKey]);
  // Listen brukeren ser fryses: lagring gjelder nøyaktig disse linjene, ikke en ny refetch.
  const [frozen, setFrozen] = useState<DecisionGroup | null>(null);
  useEffect(() => { if (live && (!frozen || frozen.key !== live.key)) setFrozen(live); }, [live, frozen]);
  const group = frozen ?? live;
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { canWrite } = useInvoiceRights();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const found = useQuery({
    queryKey: ["decision-material-search", company?.id, debounced],
    enabled: !!company?.id && debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name, base_unit, category")
        .eq("legal_entity_id", company!.id).eq("is_active", true).ilike("name", `%${debounced}%`).order("name").limit(20);
      if (error) throw new Error("Kunne ikke søke i råvarene");
      return data ?? [];
    },
  });
  const report = (label: string, r: GroupOutcome) => {
    const notes = outcomeNotes(r);
    const fails = r.outcomes.filter((o) => !o.ok).map((o) => `${o.invoiceNumber}: ${o.message}`);
    const description = [...notes, ...fails].join("\n") || undefined;
    (r.failed || notes.length ? toast.warning : toast.success)(`${label}: ${r.text}`, { description });
  };

  const done = async (msg?: string) => {
    await Promise.all(["fakturaer-review-lines", "fakturaer-inbox", "invoice-approval-overview", "vareminne-links", "supplier-cases"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    if (msg) toast.success(msg);
    // Neste spørsmål i samme filtrerte rekkefølge som brukeren kom fra.
    const all = buildDecisionGroups(q.data?.rows ?? []);
    const ordered = fromRavarer ? filterRavarerGroups(all, parseRavarerFilter(sp)) : all;
    const next = nextGroupKey(ordered, groupKey);
    if (next) navigate(`/ravarer/fakturaer/i-dag/${encodeGroupKey(next)}${sp.toString() ? `?${sp}` : ""}`);
    else navigate(backHref);
  };

  async function applyMaterial() {
    if (!group || !choice) return;
    setBusy(true);
    try {
      const targets = group.shared ? group.lines : group.lines.slice(0, 1);
      const r = await applyMaterialToLines(targets, choice);
      report(r.failed || r.learningFailed ? "Råvarevalg" : "Råvarevalg lagret og huskes", r);
      await done();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre valget");
    } finally {
      setBusy(false);
    }
  }

  async function createCase() {
    if (!group) return;
    setBusy(true);
    try {
      const id = await createSupplierCase({ lineIds: group.lines.map((l) => l.id), title: `Prisavvik ${group.description}`, reason: `Fakturert ${group.observedPerBase ?? "–"} mot ${group.expectedPerBase ?? "–"} per grunnenhet` });
      await qc.invalidateQueries({ queryKey: ["supplier-cases"] });
      toast.success("Leverandørsak opprettet. Fakturaene holdes igjen til saken er avklart.");
      navigate(`/ravarer/fakturaer/saker/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke opprette sak");
    } finally {
      setBusy(false);
    }
  }

  async function acceptPrices() {
    if (!group) return;
    setBusy(true);
    try {
      const { keep, changed } = await filterUnchanged(group.lines);
      const r = await runPerLine(keep, acceptPriceVariance);
      report("Prisavvik godtatt denne gangen (avtalen er ikke endret)", { ...r, changedSinceViewed: changed });
      await done();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setBusy(false);
    }
  }

  const first = group?.lines[0];
  const suggested = group ? materialOptions(group) : [];
  const options = [...suggested, ...(found.data ?? []).filter((m) => !suggested.some((o) => o.id === m.id))
    .map((m) => ({ id: m.id, name: m.name, detail: [m.category, m.base_unit ? `grunnenhet ${m.base_unit}` : null].filter(Boolean).join(" · "), confidence: 0 }))];
  const allPriceOk = !!group && group.lines.every(canAcceptPriceVariance);

  return (
    <div className="px-page py-6 space-y-6">
      <DecisionNav />
      <Link to={backHref} className="text-sm text-primary hover:underline">← {fromRavarer ? "Alle råvarespørsmål" : "I dag"}</Link>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="fakturaer:beslutning" onRetry={() => q.refetch()}
        isEmpty={!group} emptyTitle="Spørsmålet er allerede avklart" emptyDescription="Gå tilbake til I dag for neste beslutning.">
        {group && first && (
          <>
            <header className="space-y-2">
              <p className="text-caption uppercase tracking-wide text-ink-secondary">
                {group.supplierName} · {group.invoiceIds.length === 1 ? "1 faktura" : `${group.invoiceIds.length} fakturaer`}
              </p>
              <h1 className="font-display text-3xl font-semibold">
                {group.kind === "material" ? `Hvilken råvare er dette?` : group.kind === "price" ? "Ett prisavvik. Én beslutning." : group.kind === "package" ? "Bekreft pakningen" : group.kind === "first_cost" ? "Første kostpris" : "Avklar linjen"}
              </h1>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="rounded-xl border border-line-subtle bg-card p-5 space-y-4">
                {group.kind === "material" && (
                  <>
                    <h2 className="font-semibold">Velg råvare</h2>
                    <div role="radiogroup" aria-label="Råvare" className="space-y-2">
                      {options.length === 0 && <p className="text-sm text-ink-secondary">Ingen forslag. Søk i hele råvarelisten under.</p>}
                      {options.map((o) => (
                        <button key={o.id} type="button" role="radio" aria-checked={choice === o.id} onClick={() => setChoice(o.id)}
                          className={cn("flex w-full items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            choice === o.id ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/50")}>
                          <span className={cn("h-4 w-4 rounded-full border", choice === o.id ? "border-4 border-primary" : "border-ink-secondary")} aria-hidden />
                          <span><span className="block font-medium">{o.name}</span><span className="text-sm text-ink-secondary">{o.detail}</span></span>
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="decision-material-search">Finner du ikke riktig råvare? Søk i hele listen</Label>
                      <Input id="decision-material-search" placeholder="Minst to bokstaver" value={search} onChange={(e) => setSearch(e.target.value)} />
                      {found.isError && <p className="text-sm text-destructive">Søket feilet. Prøv igjen.</p>}
                      {debounced.length >= 2 && found.data?.length === 0 && <p className="text-sm text-ink-secondary">Ingen treff.</p>}
                      <p className="text-sm text-ink-secondary">Er det ikke en råvare (frakt, gebyr, pant)? <Link className="text-primary hover:underline" to={`/ravarer/fakturaer/til-behandling?faktura=${first.invoice_id}`}>Marker som ikke råvare på fakturaen</Link>.</p>
                    </div>
                    <div className="border-t border-line-subtle pt-3 text-sm">
                      <p className="flex items-center gap-2 font-medium text-primary"><Brain className="h-4 w-4" aria-hidden />Dette huskes</p>
                      <p>{group.shared ? `${group.supplierName} + varenummer ${group.sku} → valgt råvare.` : "Linjen mangler varenummer, så valget gjelder bare denne linjen."}</p>
                      <p className="mt-1 text-ink-secondary">Pakningen bekreftes separat. Valget godkjenner ikke fakturaen.</p>
                    </div>
                    <Button className="w-full" disabled={!choice || busy || !canWrite} onClick={applyMaterial}>
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

                {group.kind === "package" && <PackageDecision g={group} canWrite={canWrite} onSaved={() => done()} />}
                {group.kind === "first_cost" && <FirstCostDecision g={group} canWrite={canWrite} onSaved={() => done()} />}
                {group.kind === "other" && <p className="text-body">Denne linjen åpnes på fakturaen for kontroll.</p>}

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
                    <Button className="w-full" disabled={busy || !canWrite || group.differenceExclVat == null} onClick={createCase}>
                      Opprett én sak for {group.invoiceIds.length === 1 ? "fakturaen" : `${group.invoiceIds.length} fakturaer`}
                    </Button>
                    <Button variant="outline" className="w-full" disabled={busy || !canWrite || !allPriceOk} onClick={acceptPrices}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Godta prisavviket denne gangen
                    </Button>
                    {!allPriceOk && <p className="text-sm text-ink-secondary">Noen linjer har flere åpne punkter og må avklares i køen først.</p>}
                    <p className="text-sm text-ink-secondary">Avtaleprisen endres ikke. Fakturaen godkjennes eller betales ikke automatisk.</p>
                  </>
                )}
                {group.kind === "other" && (
                  <Button asChild className="w-full"><Link to={group.kind === "package" ? "/ravarer/fakturaer/ravarer" : `/ravarer/fakturaer/til-behandling?faktura=${first.invoice_id}`}>{group.kind === "package" ? "Bekreft pakning i Råvarer" : "Åpne fakturaen"}</Link></Button>
                )}
              </aside>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
