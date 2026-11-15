import { Download, Loader2, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQualityTestRun } from "@/ravarer/hooks/useQualityTestRun";
import { configLabel, estimateRunCostUsd, ratioText, summarizeConfig, type ConfigSummary, type QualityResult } from "@/ravarer/lib/qualityTest";
import { QUALITY_ROLE_LABEL, QUALITY_TEST_SET, QUALITY_TEST_VERSION, type QualityRole } from "../../../../supabase/functions/_shared/qualityTestSet.ts";

const usd = (n: number | null, d = 2) => (n == null ? "ukjent" : `$${n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const sec = (n: number | null) => (n == null ? "ukjent" : `${n.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} s`);
const ROLES: QualityRole[] = ["fasit", "vanskelig", "uten_linjer"];

/**
 * Kvalitetstest før gjenlesing: leser de samme 22 fakturaene med hvert lagret oppsett som har virkende nøkkel.
 * Ingenting lagres på fakturaene og aktivt oppsett endres ikke (serveren skriver bare bruksloggen).
 */
export function QualityTestCard() {
  const t = useQualityTestRun();
  const est = estimateRunCostUsd(t.plan.run.map((c) => c.check));
  const running = t.phase === "running" || t.phase === "checking";
  const summaries = t.plan.run.map((c) => summarizeConfig(c.check.configId, c.label, t.results));

  function exportJson() {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), test_version: QUALITY_TEST_VERSION, checks: t.checks, skipped: t.plan.skipped, summaries, results: t.results }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kvalitetstest-fakturalesing-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card id="kvalitetstest">
      <CardHeader>
        <CardTitle>Kvalitetstest før gjenlesing</CardTitle>
        <CardDescription>
          Leser {QUALITY_TEST_SET.length} faste testfakturaer med hvert lagret oppsett for fakturalesing og måler treff mot kontrollsum og godkjente linjer.
          Ingenting lagres på fakturaene, og aktivt oppsett endres ikke. Bare bruksloggen for AI får én rad per kall.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-md border border-border p-3 text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-medium">Testsettet ({QUALITY_TEST_SET.length} fakturaer)</summary>
          {ROLES.map((role) => (
            <div key={role} className="mt-2">
              <p className="font-medium">{QUALITY_ROLE_LABEL[role]}</p>
              <ul className="list-disc pl-5 text-caption text-muted-foreground">
                {QUALITY_TEST_SET.filter((e) => e.role === role).map((e) => <li key={e.invoice_id}>{e.supplier} {e.invoice_number} – {e.note}</li>)}
              </ul>
            </div>
          ))}
        </details>

        <div className="flex flex-wrap items-center gap-2">
          {t.phase !== "ready" && (
            <Button onClick={() => void t.check()} disabled={running}>
              {t.phase === "checking" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start kvalitetstest
            </Button>
          )}
          {t.phase === "ready" && (
            <Button onClick={() => void t.run()} disabled={t.plan.run.length === 0}>
              Bekreft og start: {est.calls.toLocaleString("nb-NO")} lesinger, omtrent {usd(est.total)}
            </Button>
          )}
          {t.phase === "running" && (
            <Button variant="outline" onClick={t.requestStop} className="gap-1.5"><Square className="h-4 w-4" aria-hidden />Stopp etter denne fakturaen</Button>
          )}
          <Button variant="outline" onClick={exportJson} disabled={!t.results.length || running} className="gap-1.5">
            <Download className="h-4 w-4" aria-hidden /> Eksporter resultat (JSON)
          </Button>
          {t.current && <span className="text-sm text-muted-foreground" role="status">Leser {t.current} … La siden stå åpen.</span>}
        </div>
        {t.error && <Alert variant="destructive"><AlertDescription>{t.error}</AlertDescription></Alert>}

        {t.checks.length > 0 && (
          <section className="space-y-2" aria-label="Nøkkelsjekk">
            <h4 className="text-sm font-semibold">Nøkkelsjekk (gratis, uten fakturadata)</h4>
            <Table>
              <TableHeader><TableRow><TableHead>Oppsett</TableHead><TableHead>Aktiv</TableHead><TableHead>Nøkkel</TableHead><TableHead>I testen</TableHead></TableRow></TableHeader>
              <TableBody>
                {t.checks.map((c) => {
                  const inRun = t.plan.run.some((r) => r.check.configId === c.configId);
                  const skip = t.plan.skipped.find((s) => s.check.configId === c.configId);
                  return (
                    <TableRow key={c.configId}>
                      <TableCell>{configLabel(c)}</TableCell>
                      <TableCell>{c.isActive ? "Ja" : "Nei"}</TableCell>
                      <TableCell className={c.status === "ok" ? "" : "text-destructive"}>{c.message}</TableCell>
                      <TableCell>{inRun ? (t.stoppedConfigs[c.configId] ? `Stoppet: ${t.stoppedConfigs[c.configId]}` : "Ja") : `Nei – ${skip?.reason ?? "ukjent"}`}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {t.phase === "ready" && <p className="text-caption text-muted-foreground">Overslaget er grovt (typisk forbruk per faktura, +30 % for sidebolker). Faktisk kostnad vises per kall.</p>}
          </section>
        )}

        {t.results.length > 0 && <SummaryTable summaries={summaries} />}
        {t.results.length > 0 && <InvoiceDetails results={t.results} />}
      </CardContent>
    </Card>
  );
}

function SummaryTable({ summaries }: { summaries: ConfigSummary[] }) {
  const rows: Array<[string, (s: ConfigSummary) => string]> = [
    ["Fakturaer lest", (s) => `${s.readOk.toLocaleString("nb-NO")} av ${s.invoices.toLocaleString("nb-NO")}`],
    ["Linjesum treffer kontrollsum (±2 %)", (s) => `${ratioText(s.sumHit)}${s.sumUnknown ? `, ${s.sumUnknown} ukjent` : ""}`],
    ["Fasit: riktig antall linjer", (s) => `${ratioText(s.lineCountExact)} (${s.linesRead} lest / ${s.linesExpected} fasit)`],
    ["Fasit: riktig varenummer", (s) => ratioText(s.sku)],
    ["Fasit: riktig antall", (s) => ratioText(s.qty)],
    ["Fasit: riktig enhetspris", (s) => ratioText(s.price)],
    ["Fasit: riktig beløp", (s) => ratioText(s.amount)],
    ["Antall × pris = beløp", (s) => ratioText(s.arithmetic)],
    ["Fasit: pant/frakt/gebyr som egne linjer", (s) => `${ratioText(s.feeFasit)}; ${s.feeLinesFound} slike linjer totalt`],
    ["Flersidige: enkeltlesing kuttet", (s) => `${s.singleCut} av ${s.multiPage}`],
    ["Flersidige: linjer fra siste side", (s) => ratioText(s.lastPageCovered)],
    ["Flersidige: sidebolker treffer kontrollsum", (s) => ratioText(s.chunkedHit)],
    ["Svartid per faktura", (s) => sec(s.latencyAvgS)],
    ["Kostnad per faktura", (s) => usd(s.costPerInvoiceUsd, 4)],
    ["Kostnad totalt", (s) => `${usd(s.costTotalUsd, 2)}${s.costUnknownCalls ? ` (+${s.costUnknownCalls} kall ukjent)` : ""}`],
  ];
  return (
    <section className="space-y-2" aria-label="Resultat per oppsett">
      <h4 className="text-sm font-semibold">Resultat per oppsett</h4>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Mål</TableHead>{summaries.map((s) => <TableHead key={s.configId}>{s.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map(([label, f]) => (
              <TableRow key={label}><TableCell className="font-medium">{label}</TableCell>{summaries.map((s) => <TableCell key={s.configId}>{f(s)}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-caption text-muted-foreground">Fasit er godkjente, lagrede linjer (PALS 526301: dokumentkontrollert). Linjer kobles på varenummer, ellers på entydig likt beløp; da telles ikke beløpet.</p>
    </section>
  );
}

function InvoiceDetails({ results }: { results: QualityResult[] }) {
  return (
    <section className="space-y-2" aria-label="Per faktura">
      <h4 className="text-sm font-semibold">Per faktura</h4>
      {QUALITY_TEST_SET.map((inv) => {
        const rs = results.filter((r) => r.invoiceId === inv.invoice_id);
        if (!rs.length) return null;
        return (
          <details key={inv.invoice_id} className="rounded-md border border-border p-3 text-sm">
            <summary className="min-h-11 cursor-pointer content-center">{inv.supplier} {inv.invoice_number} · {QUALITY_ROLE_LABEL[inv.role]}</summary>
            <ul className="mt-2 space-y-2">
              {rs.map((r) => {
                const m = r.metrics;
                return (
                  <li key={`${r.configId}-${r.mode}`} className="rounded border border-border p-2">
                    <p className="font-medium">{r.configLabel}{r.mode === "sidebolker" ? ` · sidebolker (${r.chunked?.chunks ?? "?"})` : ""}: <span className={r.status === "ok" ? "" : "text-destructive"}>{r.statusLabel}</span></p>
                    {r.error && <p className="text-caption text-muted-foreground">{r.error}</p>}
                    {m && (
                      <p className="text-caption">
                        {m.lineCount} linjer · linjesum {m.sum.linesSum.toLocaleString("nb-NO")} mot {m.sum.expectedExcl == null ? "ukjent" : m.sum.expectedExcl.toLocaleString("nb-NO")}
                        {m.sum.deviationPct != null ? ` (${m.sum.deviationPct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %)` : ""}
                        {m.sum.unknownReason === "mva_mangler" ? " · mva mangler i Tripletex-tallet" : ""}
                        {" · "}regnestykke {m.arithmetic.ok}/{m.arithmetic.withNumbers}
                        {" · "}pant {m.fees.pant}, frakt {m.fees.frakt}, gebyr {m.fees.gebyr}
                        {m.pages.total != null ? ` · sider med linjer ${m.pages.withLines.join(", ") || "ukjent"} av ${m.pages.total}` : ""}
                        {r.chunkSuggested ? ` · ville delt lesingen: ${r.chunkSuggested}` : ""}
                        {` · ${sec(r.latencyMs == null ? null : r.latencyMs / 1000)} · ${usd(r.costUsd, 4)}`}
                      </p>
                    )}
                    {m?.fasit && m.fasit.errors.length > 0 && (
                      <ul className="list-disc pl-4 text-caption text-destructive">{m.fasit.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}</ul>
                    )}
                    {m && m.arithmetic.failing.length > 0 && (
                      <ul className="list-disc pl-4 text-caption text-muted-foreground">{m.arithmetic.failing.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
