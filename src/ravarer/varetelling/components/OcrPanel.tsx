import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useOpAction, useVtScope } from "../hooks";
import { entryToBase, formatAmount, parseNorwegianAmount } from "../logic";
import { checkUploadFile, useStage3Api, type VtOcrJob, type VtOcrProposal } from "../stage3";
import { s3Keys, useS3Read, useStage3Ready } from "../stage3Hooks";
import type { SaveLineResult, VtCountLine, VtCountList } from "../types";
import { Notice } from "./shared";

const JOB_LABEL: Record<VtOcrJob["status"], string> = {
  opprettet: "Venter på lesing", behandler: "Leses …", ukjent_ai_utfall: "Ukjent utfall av lesingen", klar: "Lest", feilet: "Kunne ikke leses",
};

/**
 * Opplasting av utfylt papirliste for NØYAKTIG denne listen. Lesingen gir bare forslag; ingenting telles
 * før en person har bekreftet hver linje. Usikre felt står tomme med årsak.
 */
export function OcrPanel({ list, lines, open }: { list: VtCountList; lines: VtCountLine[]; open: boolean }) {
  const api = useStage3Api(); const { entity, canWrite } = useVtScope(); const qc = useQueryClient();
  const s3 = useStage3Ready();
  const jobs = useS3Read(s3Keys.jobs(entity, list.id), () => api ? api.listJobs(entity, list.id) : Promise.resolve([]));
  const [busy, setBusy] = useState(false); const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capturedList = useRef(list.id); capturedList.current = list.id;

  if (!s3.ready) return (
    <Notice title="Opplasting av papirliste er ikke tatt i bruk ennå.">
      {s3.loading ? "Kontrollerer …" : "Funksjonen blir tilgjengelig når databasedelen og lesetjenesten er godkjent og rullet ut. Registrer manuelt i mellomtiden."}
    </Notice>
  );

  const upload = async (f: File) => {
    const bad = checkUploadFile(f); if (bad) { toast.error(bad); return; }
    if (!api || !canWrite || capturedList.current !== list.id) return;
    setBusy(true);
    try {
      const r = await api.uploadAndRead({ opId: crypto.randomUUID(), listId: list.id, file: f });
      setJobId(r.jobId);
      toast[r.duplicate ? "info" : "success"](r.duplicate ? "Samme fil er lastet opp før for denne listen — viser eksisterende lesing (ingen ny lesing)." : "Lesingen er ferdig. Kontroller forslagene.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke laste opp.");
    } finally {
      setBusy(false); if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: s3Keys.jobs(entity, list.id) });
    }
  };
  const job = jobs.data?.find(j => j.id === jobId) ?? null;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-medium">Papirliste: last opp og kontroller</h3>
      <p className="text-sm text-muted-foreground">Gjelder bare «{list.department} · {list.name}». PDF eller bilde (alle sider). Forslag lagres ikke før du bekrefter hver linje.</p>
      {open && canWrite && (
        <div>
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id={`vt-ocr-${list.id}`}
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <Button asChild variant="outline" className="min-h-[48px]" disabled={busy}>
            <label htmlFor={`vt-ocr-${list.id}`} className="cursor-pointer"><FileUp className="h-4 w-4" aria-hidden /> {busy ? "Laster opp og leser …" : "Last opp utfylt liste"}</label>
          </Button>
        </div>
      )}
      {jobs.error && <Notice tone="danger" title="Kunne ikke hente opplastinger." />}
      {(jobs.data ?? []).length > 0 && (
        <ul className="space-y-1 text-sm">
          {(jobs.data ?? []).map(j => (
            <li key={j.id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{JOB_LABEL[j.status]}</Badge>
              <span>{new Date(j.created_at).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}</span>
              {j.status === "klar" && <span>{j.document_ok ? "Identitet bekreftet" : "Identitet IKKE bekreftet"}</span>}
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setJobId(j.id)}>Vis</Button>
            </li>
          ))}
        </ul>
      )}
      {job && <JobReview job={job} lines={lines} open={open} />}
    </Card>
  );
}

function JobReview({ job, lines, open }: { job: VtOcrJob; lines: VtCountLine[]; open: boolean }) {
  const api = useStage3Api(); const { entity } = useVtScope();
  const props = useS3Read(s3Keys.props(entity, job.id), () => api ? api.listProposals(entity, job.id) : Promise.resolve([]));
  const [srcUrl, setSrcUrl] = useState<string | null | "ingen">(null);
  return (
    <div className="space-y-2 border-t pt-3">
      {job.status === "ukjent_ai_utfall" && <Notice tone="danger" title="Ukjent om lesingen ble fullført.">Den startes ikke automatisk på nytt (den kan være betalt). En godkjenner må kontrollere og eventuelt bekrefte ny lesing.</Notice>}
      {job.status === "feilet" && <Notice tone="danger" title="Filen kunne ikke leses.">{job.failure_reason ?? ""}</Notice>}
      {job.status === "klar" && !job.document_ok && <Notice tone="danger" title="Dokumentet kan ikke godkjennes.">Trykt identitet eller sider stemmer ikke med denne listen. Ingen forslag kan lagres.</Notice>}
      {job.issues.length > 0 && <ul className="list-disc pl-5 text-sm">{job.issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" className="min-h-[44px]" onClick={async () => setSrcUrl((await api?.originalUrl(job)) ?? "ingen")}>Vis originalen (hel side)</Button>
        {srcUrl === "ingen" && <span className="text-muted-foreground">Originalen kan ikke vises her (demonstrasjon eller manglende tilgang).</span>}
        {srcUrl && srcUrl !== "ingen" && <a className="text-primary underline" href={srcUrl} target="_blank" rel="noreferrer">Åpne original i ny fane</a>}
      </div>
      {props.isLoading && <p className="text-sm">Henter forslag …</p>}
      {(props.data ?? []).map(p => {
        const line = lines.find(l => l.id === p.line_id);
        return line ? <ProposalCard key={p.id} p={p} line={line} docOk={job.document_ok === true} open={open} /> : <p key={p.id} className="text-sm text-destructive">Forslag for linje utenfor listen — ignorert.</p>;
      })}
      {props.data && props.data.length === 0 && job.status === "klar" && <p className="text-sm text-muted-foreground">Ingen utfylte rader ble funnet. Tomme felt tolkes ikke som 0.</p>}
    </div>
  );
}

function ProposalCard({ p, line, docOk, open }: { p: VtOcrProposal; line: VtCountLine; docOk: boolean; open: boolean }) {
  const api = useStage3Api(); const { entity, canWrite } = useVtScope(); const qc = useQueryClient();
  const [texts, setTexts] = useState(() => p.entries.map(e => (e.value != null ? String(e.value).replace(".", ",") : "")));
  const [msg, setMsg] = useState<string | null>(null);
  const acc = useOpAction(`ocr-accept:${p.id}`, "write", (opId, x: { state: "talt" | "null"; total: number; entry: { unit_id: string | null; amount: number }[] }) =>
    api ? api.accept({ opId, proposalId: p.id, lineId: line.id, expectedRevision: p.line_revision_at_job, state: x.state, countedBase: x.total, entry: x.entry, note: null }) : Promise.reject(new Error("utilgjengelig")));
  const stale = line.revision !== p.line_revision_at_job;
  const parsed = texts.map(parseNorwegianAmount);
  const units = p.entries.map(e => (e.unit_id == null ? 1 : line.snap_units.find(u => u.id === e.unit_id)?.units_in_base ?? NaN));
  const entry = p.entries.flatMap((e, i) => { const v = parsed[i]; return typeof v === "number" && Number.isFinite(units[i]) ? [{ unit_id: e.unit_id, amount: v }] : []; });
  const invalid = parsed.some(x => x === "ugyldig") || p.entries.some((e, i) => texts[i] !== "" && !Number.isFinite(units[i]));
  const total = entryToBase(entry.map(e => ({ amount: e.amount, units_in_base: e.unit_id == null ? 1 : line.snap_units.find(u => u.id === e.unit_id)?.units_in_base ?? NaN })));
  const canAccept = open && canWrite && docOk && !stale && p.status === "foreslatt" && !invalid && entry.length > 0 && total != null && !acc.busy;
  const done = (r: Awaited<ReturnType<typeof acc.execute>>) => {
    void qc.invalidateQueries({ queryKey: s3Keys.props(entity, p.job_id) });
    void qc.invalidateQueries({ queryKey: ["vt", entity, "count"] });
    if (r.kind === "ok") { const v: SaveLineResult = r.value; setMsg(v.kind === "saved" ? "Bekreftet og lagret." : "Linjen er endret av andre — ingenting ble overskrevet."); }
    else if (r.kind === "rejected" || r.kind === "unknown") setMsg(r.message);
  };
  return (
    <Card className="space-y-2 p-3 text-sm" data-testid="vt-proposal">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-medium break-words">{line.snap_name}</p>
          <p className="text-xs text-muted-foreground">Side {p.page} · radkode {p.row_code} · {p.crop ? "utsnitt" : "ingen utsnitt — se hel side"}</p></div>
        <Badge variant="outline">{p.status === "godkjent" ? (p.corrected ? "Bekreftet (rettet)" : "Bekreftet") : p.status === "avvist" ? "Avvist" : "Forslag"}</Badge>
      </div>
      {p.reasons.length > 0 && <p className="text-destructive">{p.reasons.join(", ")}</p>}
      {stale && p.status === "foreslatt" && <p className="text-destructive" role="alert">Linjen er registrert/endret etter opplastingen. Forslaget kan ikke lagres — kontroller linjen manuelt.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {p.entries.map((e, i) => (
          <label key={i}>
            <span className="mb-1 block text-muted-foreground">{e.label} · lest «{e.raw ?? "tomt"}»{e.reason ? ` — usikkert: ${e.reason}` : ""}</span>
            <Input inputMode="decimal" className="h-12" disabled={p.status !== "foreslatt" || stale || !open} value={texts[i]} aria-label={`${line.snap_name}: ${e.label} (bekreft)`}
              aria-invalid={parsed[i] === "ugyldig"} onChange={ev => setTexts(t => t.map((x, j) => (j === i ? ev.target.value : x)))} />
          </label>
        ))}
      </div>
      {total != null && !invalid && <p>Sum ved bekreftelse: <strong>{formatAmount(total)} {line.snap_base_unit ?? ""}</strong></p>}
      {p.status === "foreslatt" && open && canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-[48px]" disabled={!canAccept} onClick={() => {
            const x = { state: total === 0 ? "null" as const : "talt" as const, total: total ?? 0, entry: total === 0 ? [] : entry };
            void acc.execute(x, JSON.stringify(x)).then(done);
          }}>{total === 0 ? "Bekreft 0 på lager" : "Bekreft verdien"}</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={acc.busy} onClick={() => { void api?.reject({ opId: crypto.randomUUID(), proposalId: p.id, note: null }).then(() => { setMsg("Avvist. Linjen er uendret."); void qc.invalidateQueries({ queryKey: s3Keys.props(entity, p.job_id) }); }, (e: unknown) => setMsg(e instanceof Error ? e.message : "Kunne ikke avvise.")); }}>Avvis forslaget</Button>
          {acc.pending && <Button variant="outline" className="min-h-[48px]" onClick={() => { const x = acc.pending?.payload as { state: "talt" | "null"; total: number; entry: { unit_id: string | null; amount: number }[] } | undefined; if (x) void acc.execute(x, JSON.stringify(x)).then(done); }}>Send samme bekreftelse på nytt</Button>}
        </div>
      )}
      {!docOk && p.status === "foreslatt" && <p className="text-xs">Kan ikke bekreftes: dokumentets identitet er ikke bekreftet.</p>}
      {msg && <p aria-live="polite">{msg}</p>}
    </Card>
  );
}
