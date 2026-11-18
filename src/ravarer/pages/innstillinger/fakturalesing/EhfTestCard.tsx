// Råvarer › Innstillinger › Fakturalesing › EHF-test (bestilling 18.11.2026). Rent lesende: ingen skriving til
// fakturaer, linjer eller varer. Resultatet ligger bare i nettleseren og i JSON-eksporten.
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { osloTodayISO } from "@/lib/osloDate";
import { fetchEhfSuppliers, pickTestInvoices, runEhfProbe } from "@/ravarer/lib/ehfTest/api";
import { adviceFor, buildExport, evaluate, summarizeBySupplier, type Evaluated } from "@/ravarer/lib/ehfTest/report";
import { EhfSummaryTable } from "./ehf/EhfSummaryTable";
import { EhfInvoiceResult, NOT_DEPLOYED_TEXT } from "./ehf/EhfInvoiceResult";

const ALL = "alle";

export function EhfTestCard({ legalEntityId }: { legalEntityId: string }) {
  const rights = useInvoiceRights();
  const suppliersQ = useQuery({
    queryKey: ["ehf-test-suppliers", legalEntityId],
    queryFn: () => fetchEhfSuppliers(legalEntityId),
    enabled: rights.canApprove,
  });
  const [choice, setChoice] = useState(ALL);
  const [per, setPer] = useState("1");
  const [items, setItems] = useState<Evaluated[]>([]);
  const [phase, setPhase] = useState<"idle" | "picking" | "running" | "done">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [meta, setMeta] = useState<{ selection: string; perSupplier: number } | null>(null);
  const lock = useRef(false);
  const stop = useRef(false);

  const rows = useMemo(() => summarizeBySupplier(items), [items]);
  const advice = useMemo(() => {
    const s = new Set<string>();
    for (const e of items) if (e.outcome.kind === "ok") for (const p of e.outcome.data.probes) { const a = adviceFor(p); if (a) s.add(a); }
    return [...s];
  }, [items]);

  if (rights.loading) return null;
  if (!rights.canApprove) return null;

  const run = async () => {
    const all = suppliersQ.data;
    if (lock.current || !all) return;
    const chosen = choice === ALL ? all : all.filter((s) => s.id === choice);
    if (chosen.length === 0) return;
    lock.current = true; stop.current = false;
    const perSupplier = Number(per);
    setItems([]); setMsg(null); setNotDeployed(false); setProgress(null); setPhase("picking");
    setMeta({ selection: choice === ALL ? "Én per leverandør (alle)" : chosen[0].name, perSupplier });
    try {
      const picked = await pickTestInvoices(legalEntityId, chosen, perSupplier);
      if (picked.length === 0) { setMsg("Fant ingen fakturaer som er hentet fra Tripletex og lest fra PDF."); return; }
      setPhase("running"); setProgress({ done: 0, total: picked.length });
      for (let i = 0; i < picked.length; i++) {
        if (stop.current) { setMsg(`Stoppet etter ${i} av ${picked.length} fakturaer.`); break; }
        const outcome = await runEhfProbe(legalEntityId, picked[i].id);
        const evaluated = evaluate(picked[i], outcome);
        setItems((prev) => [...prev, evaluated]);
        setProgress({ done: i + 1, total: picked.length });
        if (outcome.kind === "ikke_utrullet") { setNotDeployed(true); break; }
        if (outcome.kind === "avvist" && (outcome.status === 401 || outcome.status === 403) && outcome.code !== "ikke_tripletex") {
          setMsg(outcome.message); break;
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Testen stoppet på grunn av en feil.");
    } finally {
      lock.current = false; setPhase("done");
    }
  };

  const download = () => {
    if (!meta) return;
    const data = buildExport(items, { generatedAt: new Date().toISOString(), ...meta });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `ehf-test-${osloTodayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const busy = phase === "picking" || phase === "running";
  return (
    <Card id="innst-fakturalesing-ehf">
      <CardHeader>
        <CardTitle>EHF-test</CardTitle>
        <CardDescription>
          Finner ut om Tripletex gir oss EHF-filen (eller strukturerte linjer) for leverandørfakturaer, og sammenligner den med linjene som er lest fra PDF.
          Testen bare leser: ingenting lagres på fakturaer, linjer eller varer. Resultatet ligger bare her og i eksporten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {suppliersQ.isError ? (
          <QueryErrorState error={suppliersQ.error} scope="ehf-test-leverandorer" onRetry={() => void suppliersQ.refetch()} title="Kunne ikke hente leverandørene" />
        ) : !suppliersQ.data ? <QueryLoadingState rows={2} /> : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="ehf-supplier">Leverandør</Label>
              <Select value={choice} onValueChange={setChoice} disabled={busy}>
                <SelectTrigger id="ehf-supplier" className="min-h-[44px] w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Én per leverandør ({suppliersQ.data.length})</SelectItem>
                  {suppliersQ.data.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ehf-per">Fakturaer per leverandør</Label>
              <Select value={per} onValueChange={setPer} disabled={busy}>
                <SelectTrigger id="ehf-per" className="min-h-[44px] w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{["1", "2", "3"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="min-h-[44px]" disabled={busy || suppliersQ.data.length === 0} onClick={() => void run()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Kjør test
            </Button>
            {phase === "running" && <Button variant="outline" className="min-h-[44px]" onClick={() => { stop.current = true; }}>Stopp</Button>}
            {items.length > 0 && !busy && (
              <Button variant="outline" className="min-h-[44px]" onClick={download}><Download className="mr-2 h-4 w-4" aria-hidden />Eksporter JSON</Button>
            )}
          </div>
        )}
        <div aria-live="polite" className="text-sm text-muted-foreground">
          {phase === "picking" && "Finner nylige fakturaer som er lest fra PDF …"}
          {phase === "running" && progress && `Tester faktura ${Math.min(progress.done + 1, progress.total)} av ${progress.total} …`}
          {phase === "done" && progress && !notDeployed && `Ferdig: ${progress.done} av ${progress.total} fakturaer testet.`}
        </div>
        {notDeployed && <p role="status" className="rounded-md border border-dashed p-3 text-sm">{NOT_DEPLOYED_TEXT}</p>}
        {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
        {advice.length > 0 && (
          <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
            <p className="font-medium">Tripletex sa nei til noe. Dette må du be om:</p>
            <ul className="list-disc space-y-1 pl-5">{advice.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        )}
        {rows.length > 0 && !notDeployed && <EhfSummaryTable rows={rows} />}
        {items.length > 0 && !notDeployed && <ul className="space-y-2">{items.map((e) => <EhfInvoiceResult key={e.invoice.id} e={e} />)}</ul>}
      </CardContent>
    </Card>
  );
}
