// «Nullstill køen» – forhåndsvisning (endrer ingenting) med eksport og én bekreftelse for å starte.
import { useRef, useState } from "react";
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { downloadCsv } from "@/varer/lib/pricing";
import { downloadBlob } from "@/ravarer/varetelling/report";
import { fetchCatalog, fetchSnapshot, startRun } from "@/ravarer/lib/nullstilling/api";
import { planPhase1 } from "@/ravarer/lib/nullstilling/plan";
import { planCsv, planJson } from "@/ravarer/lib/nullstilling/export";
import { BLOCKER_LABEL, CLOSE_REASON_LABEL, RULE_LABEL, type CloseReason, type Plan, type SnapLine } from "@/ravarer/lib/nullstilling/types";
import { fmtInt, fmtPct, Section, StatTable } from "./parts";

type St = { kind: "idle" } | { kind: "loading"; n: number } | { kind: "ready"; plan: Plan; lines: Map<string, SnapLine>; at: string } | { kind: "error"; message: string };

export function PreviewPanel({ canApprove, onStarted }: { canApprove: boolean; onStarted: () => void }) {
  const { data: company } = useCompany();
  const [st, setSt] = useState<St>({ kind: "idle" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const startLock = useRef(false);

  const load = async () => {
    if (!company) return;
    setStartErr(null); setSt({ kind: "loading", n: 0 });
    try {
      const [lines, cat] = await Promise.all([fetchSnapshot(company.id, (n) => setSt({ kind: "loading", n })), fetchCatalog(company.id)]);
      setSt({ kind: "ready", plan: planPhase1(lines, cat), lines: new Map(lines.map((l) => [l.line_id, l])), at: new Date().toISOString() });
    } catch (e) {
      setSt({ kind: "error", message: e instanceof Error ? e.message : "Kunne ikke lage forhåndsvisningen." });
    }
  };

  const start = async () => {
    if (st.kind !== "ready" || !company || startLock.current) return;
    startLock.current = true; setBusy(true); setStartErr(null);
    try {
      const plan = st.plan;
      const summary = { totals: plan.totals, cost_changes: plan.costChanges.length, creations: plan.creations.length, closes: plan.closes.length };
      const r = await startRun(company.id, plan.fingerprint, summary, plan.snapshotIds, plan.items);
      if (r.ok) { setConfirm(false); onStarted(); return; }
      setConfirm(false);
      if (r.error === "koen_endret") { setSt({ kind: "idle" }); setStartErr("Køen er endret siden forhåndsvisningen. Lag en ny forhåndsvisning før du starter."); }
      else if (r.error === "kjoring_pagar") setStartErr("En annen nullstilling pågår allerede. Last siden på nytt.");
      else setStartErr(`Kjøringen ble ikke startet (${r.error}).`);
    } catch {
      setConfirm(false); setStartErr("Utfallet er ukjent. Last siden på nytt for å se om kjøringen startet før du prøver igjen.");
    } finally { startLock.current = false; setBusy(false); }
  };

  if (st.kind !== "ready") {
    return (
      <Section title="Forhåndsvisning">
        <p className="text-body text-ink-secondary">Forhåndsvisningen leser alle åpne linjer og viser hva som ville skjedd. Den endrer ingenting.</p>
        {startErr && <p role="alert" className="mt-2 text-body text-destructive">{startErr}</p>}
        {st.kind === "error" && <p role="alert" className="mt-2 text-body text-destructive">{st.message}</p>}
        <Button className="mt-3" onClick={load} disabled={st.kind === "loading" || !company}>
          {st.kind === "loading" ? `Leser linjer … ${fmtInt(st.n)}` : "Lag forhåndsvisning"}
        </Button>
      </Section>
    );
  }

  const { plan, lines, at } = st;
  const reasons = new Map<CloseReason, number>();
  for (const c of plan.closes) if (c.reason_code) reasons.set(c.reason_code, (reasons.get(c.reason_code) ?? 0) + 1);
  const lim = (k: string, n: number) => (showAll[k] ? Infinity : n);
  const more = (k: string, total: number, n: number) => total > n && !showAll[k] && (
    <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => ({ ...s, [k]: true }))}>Vis alle {fmtInt(total)}</Button>
  );
  const stamp = at.slice(0, 16).replace(/[:T]/g, "-");

  return (
    <div className="space-y-4">
      <Section title={`Forhåndsvisning – ${fmtInt(plan.snapshotIds.length)} åpne linjer`}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`nullstilling-forhandsvisning-${stamp}.csv`, planCsv(plan, lines))}><Download className="mr-1 h-4 w-4" aria-hidden />CSV</Button>
          <Button variant="outline" size="sm" onClick={() => downloadBlob(new Blob([planJson(plan, at)], { type: "application/json" }), `nullstilling-forhandsvisning-${stamp}.json`)}><Download className="mr-1 h-4 w-4" aria-hidden />JSON</Button>
          <Button variant="ghost" size="sm" onClick={load}>Les på nytt</Button>
        </>}>
        <StatTable head={["Regel", "Linjer", "Leverandørvarer", "Varer", "Nye varer"]}
          rows={([1, 2, 3, 4, 6] as const).map((r) => [`${r}. ${RULE_LABEL[r]}`, fmtInt(plan.totals[r].lines), fmtInt(plan.totals[r].supplierItems), fmtInt(plan.totals[r].rawMaterials), r === 4 ? fmtInt(plan.totals[4].newItems) : ""])} />
        <p className="mt-2 text-caption text-ink-secondary">
          Regel 5 (sumavvik) er med i regel 6. Tallene for regel 2–6 er et anslag: etter regel 1–4 regnes fakturaene om, og det som fortsatt er åpent avsluttes (regel 6) eller godtas (prisavvik ≤ 20 %).
        </p>
      </Section>

      <Section title="Per leverandør">
        <StatTable head={["Leverandør", "Linjer", "Regel 1", "Regel 2", "Regel 3", "Regel 4", "Regel 6"]}
          rows={plan.bySupplier.slice(0, lim("sup", 25)).map((s) => [s.name || "Ukjent leverandør", fmtInt(s.lines), fmtInt(s.byRule[1]), fmtInt(s.byRule[2]), fmtInt(s.byRule[3]), fmtInt(s.byRule[4]), fmtInt(s.byRule[6])])} />
        {more("sup", plan.bySupplier.length, 25)}
      </Section>

      <Section title={`Varer som får ny kostpris (anslag) – ${fmtInt(plan.costChanges.length)}`}>
        {plan.costChanges.length === 0 ? <p className="text-body text-ink-secondary">Ingen.</p> : (
          <StatTable head={["Vare", "Før", "Etter", "Endring", "Regel"]}
            rows={plan.costChanges.slice(0, lim("cost", 30)).map((c) => [c.name, c.before == null ? "ingen" : `${fmtInt(c.before, 2)} kr/${c.base_unit ?? ""}`, `${fmtInt(c.after, 2)} kr/${c.base_unit ?? ""}`, fmtPct(c.pct), String(c.rule)])} />
        )}
        {more("cost", plan.costChanges.length, 30)}
        <p className="mt-2 text-caption text-ink-secondary">Endelig kostpris settes av den vanlige prisvelgeren (nyeste gyldige pris), slik som når du trykker knappene selv.</p>
      </Section>

      <Section title={`Varer som opprettes – ${fmtInt(plan.creations.length)}`}>
        {plan.creations.length === 0 ? <p className="text-body text-ink-secondary">Ingen.</p> : (
          <StatTable head={["Navn", "Leverandør", "Varenøkkel", "Type", "Pakning", "Linjer", "Pris"]}
            rows={plan.creations.slice(0, lim("new", 30)).map((c) => [c.name, c.supplier_name ?? "", c.item_key.replace(/^sku:/, ""), c.item_type,
              c.package ? `${fmtInt(c.package.package_size, 3)} ${c.package.package_unit}` : "", fmtInt(c.lines), c.price == null ? "" : `${fmtInt(c.price, 2)} kr/${c.base_unit}`])} />
        )}
        {more("new", plan.creations.length, 30)}
      </Section>

      <Section title={`Lukkes («Avsluttet ved nullstilling») – ${fmtInt(plan.closes.length)} linjer`}>
        <StatTable head={["Årsak", "Linjer"]} rows={[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => [CLOSE_REASON_LABEL[r], fmtInt(n)])} />
        <p className="mt-2 text-caption text-ink-secondary">Lukkes via «Hold utenfor» med egen kategori: ingen prisobservasjon, ingen kostendring, ingen ny vare. Kan åpnes igjen samlet eller enkeltvis. Full liste ligger i eksporten.</p>
      </Section>

      {plan.leftOpen.length > 0 && (
        <Section title={`Blir stående åpne – ${fmtInt(plan.leftOpen.length)} linjer`}>
          <p className="mb-2 text-body text-ink-secondary">Disse kan ikke holdes utenfor fordi de allerede har kostpris, lager, varemottak eller prisobservasjon. Nullstillingen rører dem ikke; de blir liggende i Fra faktura.</p>
          <StatTable head={["Linje", "Leverandør", "Faktura", "Hvorfor"]} rows={plan.leftOpen.slice(0, lim("open", 30)).map((o) => [o.description ?? "", o.supplier_name ?? "", o.invoice_number ?? "", BLOCKER_LABEL[o.blocker] ?? o.blocker])} />
          {more("open", plan.leftOpen.length, 30)}
        </Section>
      )}

      <Section title="Start">
        {startErr && <p role="alert" className="mb-2 text-body text-destructive">{startErr}</p>}
        {!canApprove ? <p className="text-body text-ink-secondary">Bare godkjennere og administratorer kan starte nullstillingen.</p> : (
          <Button onClick={() => setConfirm(true)} disabled={busy}><Play className="mr-1 h-4 w-4" aria-hidden />Nullstill køen …</Button>
        )}
      </Section>

      <AlertDialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nullstill køen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-body">
                <p>{fmtInt(plan.snapshotIds.length)} åpne linjer behandles med de samme handlingene som knappene i Fra faktura: {fmtInt(plan.totals[1].lines)} «ikke vare», {fmtInt(plan.totals[2].lines)} «prisen stemmer», {fmtInt(plan.totals[3].lines)} bekreftet pakning, {fmtInt(plan.totals[4].lines)} koblet/opprettet ({fmtInt(plan.totals[4].newItems)} nye varer). Resten avsluttes.</p>
                <p>Når alt er ferdig uten feil, settes grensen for prishopp til 1 %. Ingenting avstemmes eller godkjennes automatisk.</p>
                <p>Hold siden åpen mens kjøringen pågår. Du kan sette den på pause eller stoppe den.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void start(); }}>{busy ? "Starter …" : "Nullstill køen"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
