import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { EVAL_MODEL_OPTIONS, invokeModelEval, MAX_EVAL_INVOICES, type EvalOutcome } from "@/ravarer/lib/modelEval";
import { formatDate } from "@/fakturaer/lib/constants";

interface InvoiceOpt { id: string; invoice_number: string | null; invoice_date: string | null; supplier: string | null }

const nb = (n: number | null, d = 0) => (n == null ? "ukjent" : n.toLocaleString("nb-NO", { maximumFractionDigits: d, minimumFractionDigits: d }));

/** Skrivebeskyttet sammenligning av modeller på lagrede original-PDF-er. Bare administratorer (serveren avgjør). */
export function ModelEvalCard() {
  const company = useCompany();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<InvoiceOpt[]>([]);
  const [models, setModels] = useState<string[]>(EVAL_MODEL_OPTIONS.map((m) => m.value));
  const [results, setResults] = useState<EvalOutcome[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const lock = useRef(false);

  const search = useQuery({
    queryKey: ["model-eval-invoices", company.data?.id, q],
    enabled: !!company.data?.id,
    queryFn: async (): Promise<InvoiceOpt[]> => {
      let qb = supabase.from("invoices").select("id, invoice_number, invoice_date, suppliers(name)")
        .eq("legal_entity_id", company.data!.id).not("source_document_url", "is", null)
        .order("invoice_date", { ascending: false }).limit(15);
      if (q.trim()) qb = qb.ilike("invoice_number", `%${q.trim().replace(/[%_]/g, "")}%`);
      const { data, error } = await qb;
      if (error) throw new Error("Kunne ikke søke i fakturaer");
      return (data ?? []).map((r) => ({
        id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
        supplier: (Array.isArray(r.suppliers) ? r.suppliers[0]?.name : (r.suppliers as { name?: string } | null)?.name) ?? null,
      }));
    },
  });

  async function run() {
    if (lock.current || !picked.length || !models.length) return;
    lock.current = true;
    setResults([]);
    try {
      // Én faktura og én modell per kall, i rekkefølge. Ingen nye forsøk.
      for (const inv of picked) for (const m of models) {
        setRunning(`${inv.invoice_number ?? inv.id} · ${m}`);
        const r = await invokeModelEval(inv.id, m);
        setResults((prev) => [...prev, r]);
      }
    } finally {
      setRunning(null);
      lock.current = false;
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), quality: "ikke_verifisert", results }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `modellsammenligning-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sammenlign modeller på fakturaer</CardTitle>
        <CardDescription>
          Leser lagrede originaler med samme leseregler for hver modell. Ingenting lagres på fakturaene, og modelloppsettet endres ikke.
          Kvalitet vises bare for fakturaer med manuelt verifisert fasit (nå PALS 526301); ellers «ikke verifisert».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="eval-search">Velg fakturaer (maks {MAX_EVAL_INVOICES})</Label>
            <Input id="eval-search" placeholder="Fakturanummer" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-56 overflow-auto rounded-md border border-border text-sm">
              {search.isError && <li className="p-2 text-destructive">Kunne ikke søke. <button className="underline" onClick={() => void search.refetch()}>Prøv igjen</button></li>}
              {search.isLoading && <li className="p-2 text-muted-foreground">Laster…</li>}
              {(search.data ?? []).map((inv) => {
                const on = picked.some((p) => p.id === inv.id);
                return (
                  <li key={inv.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2">
                      <Checkbox checked={on} disabled={!on && picked.length >= MAX_EVAL_INVOICES}
                        onCheckedChange={(v) => setPicked((p) => (v ? [...p, inv] : p.filter((x) => x.id !== inv.id)))} />
                      <span>{inv.invoice_number ?? "uten nr."} · {inv.supplier ?? "ukjent leverandør"} · {inv.invoice_date ? formatDate(inv.invoice_date) : "uten dato"}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Modeller</legend>
            {EVAL_MODEL_OPTIONS.map((m) => (
              <label key={m.value} className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox checked={models.includes(m.value)} onCheckedChange={(v) => setModels((p) => (v ? [...p, m.value] : p.filter((x) => x !== m.value)))} />
                {m.label}
              </label>
            ))}
            <p className="text-caption text-muted-foreground">Valgt: {picked.map((p) => p.invoice_number).join(", ") || "ingen"}</p>
          </fieldset>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run()} disabled={!!running || !picked.length || !models.length}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sammenlign modeller
          </Button>
          <Button variant="outline" onClick={exportJson} disabled={!results.length || !!running} className="gap-1.5">
            <Download className="h-4 w-4" /> Eksporter JSON
          </Button>
          {running && <span className="self-center text-sm text-muted-foreground" role="status">Kjører {running} …</span>}
        </div>
        {results.length > 0 && <EvalResults results={results} />}
      </CardContent>
    </Card>
  );
}

export function EvalResults({ results }: { results: EvalOutcome[] }) {
  const invoices = [...new Set(results.map((r) => r.invoiceId))];
  return (
    <div className="space-y-4">
      {invoices.map((id) => {
        const rs = results.filter((r) => r.invoiceId === id);
        return (
          <section key={id} className="space-y-2">
            <h4 className="text-sm font-semibold">Faktura {rs[0]?.invoiceNumber ?? id}</h4>
            <div className="grid gap-3 md:grid-cols-3">
              {rs.map((r) => (
                <article key={r.model} className="space-y-1 rounded-md border border-border p-3 text-sm">
                  <h5 className="font-medium">{r.model}</h5>
                  <p className={r.status === "ok" ? "" : "text-destructive"}>{r.statusLabel}</p>
                  {r.error && <p className="text-caption text-muted-foreground">{r.error}</p>}
                  <dl className="grid grid-cols-2 gap-x-2 text-caption">
                    <dt>Linjer lest</dt><dd>{r.lineCount == null ? "–" : nb(r.lineCount)} (lagret {r.storedLineCount == null ? "ukjent" : nb(r.storedLineCount)}, ikke fasit)</dd>
                    <dt>Kontrollfeil</dt><dd>{r.checkCount == null ? "–" : nb(r.checkCount)}</dd>
                    <dt>Tokens inn/ut</dt><dd>{nb(r.usage.input)} / {nb(r.usage.output)}</dd>
                    <dt>Bufret / resonnering</dt><dd>{nb(r.usage.cached)} / {nb(r.usage.reasoning)}</dd>
                    <dt>Anslått kostnad</dt><dd>{r.costUsd == null ? "ukjent" : `$${nb(r.costUsd, 4)}`}</dd>
                    <dt>Svartid</dt><dd>{r.latencyMs == null ? "ukjent" : `${nb(r.latencyMs / 1000, 1)} s`}</dd>
                    <dt>Kvalitet</dt><dd>{r.fasit ? `${nb(r.fasit.correct)} av ${nb(r.fasit.total)} felt riktig mot fasit${r.fasit.unresolved > 0 ? `, ${nb(r.fasit.unresolved)} uavklart` : ""}` : "ikke verifisert"}</dd>
                    {r.fasit && <><dt>Varenummer (SKU)</dt><dd>{r.fasit.skuMatched == null || r.fasit.skuExpected == null ? "ukjent" : `${nb(r.fasit.skuMatched)} av ${nb(r.fasit.skuExpected)} lest riktig`}</dd></>}
                  </dl>
                  {r.fasit && r.fasit.errors.length > 0 && (
                    <ul className="list-disc pl-4 text-caption text-destructive">{r.fasit.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
                  )}
                  {r.fasit && r.fasit.unresolvedRows.length > 0 && (
                    <div className="text-caption text-ink-secondary">
                      <p>Uavklarte leste rader (ikke koblet til fasit på SKU):</p>
                      <ul className="list-disc pl-4">{r.fasit.unresolvedRows.map((e) => <li key={e}>{e}</li>)}</ul>
                    </div>
                  )}
                  {Object.keys(r.checkCounts).length > 0 && (
                    <ul className="list-disc pl-4 text-caption text-muted-foreground">
                      {Object.entries(r.checkCounts).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
