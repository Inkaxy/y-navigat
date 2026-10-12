import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useOpAction, useVtScope } from "../hooks";
import { entryToBase, formatAmount, moveItem, parseNorwegianAmount } from "../logic";
import { checkUploadFiles, OCR_ACCEPT, useStage3Api, VtStaleContextError, type VtOcrJob, type VtOcrProposal, type VtPageSource } from "../stage3";
import { s3Keys, useS3Read, useStage3Ready } from "../stage3Hooks";
import type { SaveLineResult, VtCountLine, VtCountList } from "../types";
import { proposalResolution, type EntryDecision } from "../../../../supabase/pending/functions/vt-count-ocr/ocrCore";
import { NativeSelect, Notice } from "./shared";

const JOB_LABEL: Record<VtOcrJob["status"], string> = {
  opprettet: "Venter på lesing", behandler: "Leses …", ukjent_ai_utfall: "Ukjent utfall av lesingen", klar: "Lest", feilet: "Kunne ikke leses",
};

/**
 * Opplasting av utfylt papirliste (alle sider, i rekkefølge) for NØYAKTIG denne listen. Lesingen gir bare forslag;
 * hver linje må bekreftes, og hvert usikkert felt må få verdi eller utelates med begrunnelse.
 */
export function OcrPanel({ list, lines, open }: { list: VtCountList; lines: VtCountLine[]; open: boolean }) {
  const api = useStage3Api(); const { entity, userId, canWrite } = useVtScope(); const qc = useQueryClient();
  const s3 = useStage3Ready();
  const jobs = useS3Read(s3Keys.jobs(entity, list.id), () => (api ? api.listJobs(entity, list.id) : Promise.resolve([])));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false); const [jobId, setJobId] = useState<string | null>(null);
  const lock = useRef(false); const mounted = useRef(true);
  const ctx = useRef({ entity, userId, listId: list.id, canWrite }); ctx.current = { entity, userId, listId: list.id, canWrite };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setFiles([]); setJobId(null); }, [list.id, entity, userId]);

  if (!s3.ready) return (
    <Notice title="Opplasting av papirliste er ikke tatt i bruk ennå.">
      {s3.loading ? "Kontrollerer …" : "Funksjonen blir tilgjengelig når databasedelen og lesetjenesten er godkjent og rullet ut. Registrer manuelt i mellomtiden."}
    </Notice>
  );

  const upload = async () => {
    const bad = checkUploadFiles(files); if (bad) { toast.error(bad); return; }
    if (!api || !canWrite || lock.current) return;
    lock.current = true; setBusy(true);
    const frozen = { ...ctx.current };
    const guard = () => mounted.current && ctx.current.entity === frozen.entity && ctx.current.userId === frozen.userId && ctx.current.listId === frozen.listId && ctx.current.canWrite;
    try {
      const r = await api.uploadAndRead({ opId: crypto.randomUUID(), listId: frozen.listId, files, guard });
      if (!guard()) return;
      setJobId(r.jobId); setFiles([]);
      toast[r.duplicate ? "info" : "success"](r.duplicate ? "De samme sidene er lastet opp før for denne listen — viser eksisterende lesing (ingen ny lesing)." : r.status === "klar" ? "Lesingen er ferdig. Kontroller forslagene." : "Lesingen fikk ikke et kjent utfall. Se status.");
    } catch (e) {
      if (e instanceof VtStaleContextError || !guard()) return;
      toast.error(e instanceof Error ? e.message : "Kunne ikke laste opp.");
    } finally {
      lock.current = false; if (mounted.current) setBusy(false);
      void qc.invalidateQueries({ queryKey: s3Keys.jobs(frozen.entity, frozen.listId) });
    }
  };
  const job = jobs.data?.find(j => j.id === jobId) ?? null;

  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-medium">Papirliste: last opp og kontroller</h3>
      <p className="text-sm text-muted-foreground">Gjelder bare «{list.department} · {list.name}». Last opp alle sider i rekkefølge (PDF eller ett bilde per side, maks 20). Forslag lagres ikke før du bekrefter hver linje.</p>
      {open && canWrite && (
        <div className="space-y-2">
          <input type="file" multiple accept={OCR_ACCEPT} className="sr-only" id={`vt-ocr-${list.id}`} disabled={busy}
            onChange={e => { const fs = Array.from(e.target.files ?? []); setFiles(cur => [...cur, ...fs].slice(0, 20)); e.target.value = ""; }} />
          <Button asChild variant="outline" className="min-h-[48px]"><label htmlFor={`vt-ocr-${list.id}`} className="cursor-pointer"><FileUp className="h-4 w-4" aria-hidden /> Velg sider</label></Button>
          {files.length > 0 && (
            <ol className="space-y-1 text-sm" aria-label="Sider som lastes opp">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-1">
                  <span className="min-w-0 flex-1 break-words">Side {i + 1}: {f.name}</span>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Flytt side ${i + 1} opp`} disabled={i === 0 || busy} onClick={() => setFiles(x => moveItem(x, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Flytt side ${i + 1} ned`} disabled={i === files.length - 1 || busy} onClick={() => setFiles(x => moveItem(x, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Fjern side ${i + 1}`} disabled={busy} onClick={() => setFiles(x => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </li>
              ))}
            </ol>
          )}
          {files.length > 0 && <Button className="min-h-[48px]" disabled={busy} onClick={() => void upload()}>{busy ? "Laster opp og leser …" : `Last opp ${files.length} side${files.length === 1 ? "" : "r"} og les`}</Button>}
        </div>
      )}
      {jobs.error && <Notice tone="danger" title="Kunne ikke hente opplastinger." />}
      {(jobs.data ?? []).length > 0 && (
        <ul className="space-y-1 text-sm">
          {(jobs.data ?? []).map(j => (
            <li key={j.id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{JOB_LABEL[j.status]}</Badge>
              <span>{new Date(j.created_at).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })} · {j.originals.length} fil(er)</span>
              {j.status === "klar" && <span>{j.document_ok ? "Identitet bekreftet" : "Kan ikke godkjennes"}</span>}
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setJobId(j.id)}>Vis</Button>
            </li>
          ))}
        </ul>
      )}
      {job && <JobReview key={job.id} job={job} lines={lines} open={open} />}
    </Card>
  );
}

/** Hva visningen skal vise for en lest side: kildefil + side i filen (PDF), og bevart original om den finnes. Null = ukjent. */
export function viewTargetOf(job: VtOcrJob, src: VtPageSource | null): { file: number; page: number; original: number | null } | null {
  if (!src) return null;
  const f = job.originals[src.file_index]; if (!f || f.role !== "side") return null;
  const oi = src.original_index ?? f.original_index; const orig = oi != null && job.originals[oi]?.role === "original" ? oi : null;
  return { file: src.file_index, page: src.file_page, original: orig };
}
const isNarrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023px)").matches;

function JobReview({ job, lines, open }: { job: VtOcrJob; lines: VtCountLine[]; open: boolean }) {
  const api = useStage3Api(); const { entity, canApprove, canWrite } = useVtScope(); const qc = useQueryClient();
  const props = useS3Read(s3Keys.props(entity, job.id), () => (api ? api.listProposals(entity, job.id) : Promise.resolve([])));
  const [urls, setUrls] = useState<(string | null)[] | null>(null);
  const first = viewTargetOf(job, job.page_sources[0] ?? null);
  const [view, setView] = useState<{ file: number; page: number; showOriginal: boolean }>(() => ({ file: first?.file ?? job.originals.findIndex(o => o.role === "side"), page: first?.page ?? 1, showOriginal: false }));
  const [zoom, setZoom] = useState(100); const [back, setBack] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const viewer = useRef<HTMLElement | null>(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { let alive = true; void api?.originalUrls(job).then(u => { if (alive) setUrls(u); }, () => { if (alive) setUrls([]); }); return () => { alive = false; }; }, [api, job]);
  const reset = useOpAction(`ocr-reset:${job.id}`, "approve", (opId, x: { jobId: string }) => (api ? api.resetUnknown({ opId, jobId: x.jobId }) : Promise.reject(new Error("utilgjengelig"))));
  const [resuming, setResuming] = useState(false);
  const target = viewTargetOf(job, job.page_sources.find(ps => ps.file_index === view.file && ps.file_page === view.page) ?? null);
  const fileIdx = view.showOriginal && target?.original != null ? target.original : view.file;
  const url = urls?.[fileIdx] ?? null; const orig = job.originals[fileIdx];
  const showSource = (p: VtOcrProposal, cardId: string) => {
    const t = viewTargetOf(job, p.source); if (!t) return;
    setView({ file: t.file, page: t.page, showOriginal: false }); setBack(cardId);
    // Mobil: hopp til originalen og fokuser den; «Tilbake til feltet» returnerer. Bred skjerm: originalen står fast ved siden av.
    requestAnimationFrame(() => { if (isNarrow()) { viewer.current?.scrollIntoView({ block: "start" }); viewer.current?.focus({ preventScroll: true }); } });
  };
  const returnToField = () => {
    const el = back ? document.getElementById(back) : null; if (!el) return;
    el.scrollIntoView({ block: "center" }); el.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),button:not([disabled])")?.focus({ preventScroll: true });
  };
  const sideOptions = job.page_sources.length > 0
    ? job.page_sources.map((ps, i) => ({ key: `${ps.file_index}:${ps.file_page}`, label: `Lest side ${i + 1} (fil ${ps.file_index + 1}${job.originals[ps.file_index]?.mime === "application/pdf" ? `, s. ${ps.file_page}` : ""})`, ps }))
    : job.originals.flatMap((o, i) => (o.role === "side" ? [{ key: `${i}:1`, label: `Fil ${i + 1}`, ps: { file_index: i, file_page: 1, original_index: o.original_index } }] : []));
  return (
    <div className="space-y-2 border-t pt-3">
      {(job.status === "ukjent_ai_utfall" || job.status === "behandler") && (
        <Notice tone="danger" title={job.status === "behandler" ? "Lesingen pågår eller ble avbrutt." : "Ukjent om lesingen ble fullført."}>
          Den startes ikke automatisk på nytt (den kan være betalt). {job.detail ?? ""}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-[48px]" onClick={() => void api?.jobStatus(job.id).then(s => setStatus(`${JOB_LABEL[s.status]}${s.leaseExpired ? " — en del ble ikke fullført innen fristen (ukjent utfall)" : ""}${s.pageCount ? ` · ${s.pagesDone} av ${s.pageCount} sider lagret` : ""} · forsøk ${s.attempts}`), () => setStatus("Kunne ikke hente status. Utfallet er fortsatt ukjent."))}>Sjekk status (skrivebeskyttet)</Button>
            {canApprove && job.status === "ukjent_ai_utfall" || canApprove && job.status === "behandler" ? <Button variant="outline" className="min-h-[48px]" disabled={reset.busy} onClick={() => {
              if (!window.confirm("Bekreft at forrige lesing er kontrollert, og at gjenstående sider kan leses på nytt (kan koste).")) return;
              void reset.execute({ jobId: job.id }, job.id).then(r => {
                setStatus(r.kind === "ok" ? (r.value.resume ? "Bekreftet. Lagrede sider beholdes — trykk «Les gjenstående sider»." : "Klar for ny lesing. Last opp de samme sidene på nytt for å starte.")
                  : r.kind === "rejected" || r.kind === "unknown" ? r.message : null);
                void qc.invalidateQueries({ queryKey: s3Keys.jobs(entity, job.count_list_id) });
              });
            }}>Tillat ny lesing …</Button> : null}
            {job.status === "behandler" && canWrite && <Button variant="outline" className="min-h-[48px]" disabled={resuming} onClick={() => {
              if (!api) return; setResuming(true);
              void api.resumeRead({ jobId: job.id, guard: () => mounted.current }).then(r => setStatus(r.status === "klar" ? "Lesingen er ferdig." : `Status: ${r.status}. Ingen automatisk ny lesing.`),
                e => setStatus(e instanceof Error ? e.message : "Ukjent utfall — sjekk status."))
                .finally(() => { if (mounted.current) setResuming(false); void qc.invalidateQueries({ queryKey: s3Keys.jobs(entity, job.count_list_id) }); });
            }}>Les gjenstående sider</Button>}
          </div>
          {status && <p className="mt-1" aria-live="polite">{status}</p>}
        </Notice>
      )}
      {job.status === "feilet" && <Notice tone="danger" title="Filene kunne ikke leses.">{job.detail ?? ""}</Notice>}
      {job.status === "klar" && !job.document_ok && <Notice tone="danger" title="Dokumentet kan ikke godkjennes.">Sider, trykt identitet eller rader stemmer ikke med denne listen. Ingen forslag kan lagres — last opp riktige, komplette sider.</Notice>}
      {job.issues.length > 0 && <ul className="list-disc pl-5 text-sm">{job.issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section ref={viewer} tabIndex={-1} aria-label="Original" data-testid="vt-original"
          className="space-y-2 rounded-md border p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:sticky lg:top-2 lg:order-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <NativeSelect aria-label="Velg lest side" className="w-auto" value={`${view.file}:${view.page}`}
              onChange={e => { const o = sideOptions.find(x => x.key === e.target.value); if (o) setView({ file: o.ps.file_index, page: o.ps.file_page, showOriginal: false }); }}>
              {sideOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="Forstørrelse" className="w-auto" value={String(zoom)} onChange={e => setZoom(Number(e.target.value))}>
              {[100, 150, 200, 300].map(z => <option key={z} value={z}>{z} %</option>)}
            </NativeSelect>
            {target?.original != null && (
              <Button variant="outline" size="sm" className="min-h-[48px]" onClick={() => setView(v => ({ ...v, showOriginal: !v.showOriginal }))}>
                {view.showOriginal ? "Vis lest side" : "Vis bevart original"}
              </Button>
            )}
            {back && <Button variant="ghost" size="sm" className="min-h-[48px] lg:hidden" onClick={returnToField}>Tilbake til feltet</Button>}
          </div>
          <p className="text-xs text-muted-foreground" data-testid="vt-original-label">
            {view.showOriginal && target?.original != null ? `Bevart original (fil ${target.original + 1}) for lest side i fil ${view.file + 1}` : `Fil ${view.file + 1}${orig?.mime === "application/pdf" ? `, side ${view.page}` : ""}`}{target?.original != null && !view.showOriginal ? " · avledet fra bevart original" : ""}
          </p>
          <div className="max-h-[70vh] overflow-auto">
            {urls == null ? <p className="text-sm">Henter original …</p>
              : !url ? <p className="text-sm text-muted-foreground">Originalen kan ikke vises her (manglende fil eller tilgang).</p>
              : orig?.mime === "application/pdf" ? <iframe key={`${fileIdx}:${view.page}`} title={`Fil ${fileIdx + 1}, side ${view.page}`} src={`${url}#page=${view.page}`} style={{ width: `${zoom}%`, height: "70vh" }} />
              : <img src={url} alt={`Fil ${fileIdx + 1}${view.showOriginal ? " (bevart original)" : ""}`} style={{ width: `${zoom}%`, maxWidth: "none" }} />}
          </div>
        </section>
        <div className="space-y-2 lg:order-1">
          {props.isLoading && <p className="text-sm">Henter forslag …</p>}
          {(props.data ?? []).map(p => {
            const line = lines.find(l => l.id === p.line_id);
            return line ? <ProposalCard key={p.id} p={p} line={line} docOk={job.status === "klar" && job.document_ok === true} open={open}
                canShow={viewTargetOf(job, p.source) != null} onShowPage={() => showSource(p, `vt-prop-${p.id}`)} />
              : <p key={p.id} className="text-sm text-destructive">Forslag for linje utenfor listen — ignorert.</p>;
          })}
          {props.data && props.data.length === 0 && job.status === "klar" && <p className="text-sm text-muted-foreground">Ingen utfylte rader ble funnet. Tomme felt tolkes ikke som 0.</p>}
        </div>
      </div>
    </div>
  );
}

type AccP = { state: "talt" | "null"; total: number; entry: { unit_id: string | null; amount: number }[]; exclusions: { label: string; reason: string }[] };
function ProposalCard({ p, line, docOk, open, canShow, onShowPage }: { p: VtOcrProposal; line: VtCountLine; docOk: boolean; open: boolean; canShow: boolean; onShowPage: () => void }) {
  const api = useStage3Api(); const { entity, canWrite } = useVtScope(); const qc = useQueryClient();
  const [dec, setDec] = useState<(Omit<EntryDecision, "value"> & { text: string })[]>(() => p.entries.map(e => ({
    text: e.value != null && e.unit_known ? String(e.value).replace(".", ",") : "", unit_id: e.unit_known ? e.unit_id : null, unit_chosen: e.unit_known, excluded: false, exclude_reason: "",
  })));
  const [msg, setMsg] = useState<string | null>(null);
  const acc = useOpAction(`ocr-accept:${p.id}`, "write", (opId, x: AccP) =>
    api ? api.accept({ opId, proposalId: p.id, lineId: line.id, expectedRevision: p.line_revision_at_job, state: x.state, countedBase: x.total, entry: x.entry, note: null, exclusions: x.exclusions }) : Promise.reject(new Error("utilgjengelig")));
  const rej = useOpAction(`ocr-reject:${p.id}`, "write", (opId, x: { note: string | null }) => (api ? api.reject({ opId, proposalId: p.id, note: x.note }) : Promise.reject(new Error("utilgjengelig"))));
  const stale = line.revision !== p.line_revision_at_job;
  const decisions: EntryDecision[] = dec.map(d => { const v = parseNorwegianAmount(d.text); return { value: typeof v === "number" ? v : null, unit_id: d.unit_id, unit_chosen: d.unit_chosen, excluded: d.excluded, exclude_reason: d.exclude_reason }; });
  const res = proposalResolution(p.entries, decisions);
  const factor = (u: string | null) => (u == null ? 1 : line.snap_units.find(x => x.id === u)?.units_in_base ?? NaN);
  const kept = decisions.filter(d => !d.excluded && d.value != null);
  const entry = kept.map(d => ({ unit_id: d.unit_id, amount: d.value ?? 0 }));
  const total = entry.length ? entryToBase(entry.map(e => ({ amount: e.amount, units_in_base: factor(e.unit_id) }))) : null;
  const canAccept = open && canWrite && docOk && !stale && p.status === "foreslatt" && res.ok && total != null && Number.isFinite(total) && !acc.busy && !acc.pending;
  const done = (r: Awaited<ReturnType<typeof acc.execute>>) => {
    void qc.invalidateQueries({ queryKey: s3Keys.props(entity, p.job_id) });
    void qc.invalidateQueries({ queryKey: ["vt", entity, "count"] });
    if (r.kind === "ok") { const v: SaveLineResult = r.value; setMsg(v.kind === "saved" ? "Bekreftet og lagret." : "Linjen er endret av andre — ingenting ble overskrevet."); }
    else if (r.kind === "rejected" || r.kind === "unknown") setMsg(r.message);
  };
  const set = (i: number, patch: Partial<(typeof dec)[number]>) => setDec(d => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const editable = p.status === "foreslatt" && !stale && open;
  return (
    <Card id={`vt-prop-${p.id}`} className="space-y-2 p-3 text-sm" data-testid="vt-proposal">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-medium break-words">{line.snap_name}</p>
          <p className="text-xs text-muted-foreground">Trykt side {p.page} · radkode {p.row_code} · {canShow ? <button type="button" className="inline-flex min-h-[44px] items-center underline" onClick={onShowPage}>vis siden</button> : <span>kildeside ukjent</span>}</p></div>
        <Badge variant="outline">{p.status === "godkjent" ? "Bekreftet" : p.status === "avvist" ? "Avvist" : "Forslag"}</Badge>
      </div>
      {p.reasons.length > 0 && <p className="text-destructive">{p.reasons.join(", ")}</p>}
      {stale && p.status === "foreslatt" && <p className="text-destructive" role="alert">Linjen er registrert/endret etter opplastingen. Forslaget kan ikke lagres — kontroller linjen manuelt.</p>}
      <div className="space-y-2">
        {p.entries.map((e, i) => (
          <fieldset key={i} className="rounded border p-2">
            <legend className="px-1 text-muted-foreground">{e.label} · lest «{e.raw ?? "tomt"}»{e.reason ? ` — ${e.reason}` : ""}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {!e.unit_known && (
                <NativeSelect aria-label={`${line.snap_name}: enhet for «${e.label}»`} disabled={!editable || dec[i].excluded} value={dec[i].unit_chosen ? dec[i].unit_id ?? "base" : ""}
                  onChange={ev => set(i, ev.target.value === "" ? { unit_chosen: false, unit_id: null } : { unit_chosen: true, unit_id: ev.target.value === "base" ? null : ev.target.value })}>
                  <option value="">Velg enhet …</option>
                  {line.snap_units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                  {line.snap_base_unit && <option value="base">{line.snap_base_unit} (løs)</option>}
                </NativeSelect>
              )}
              <Input inputMode="decimal" className="h-12" disabled={!editable || dec[i].excluded} value={dec[i].text} aria-label={`${line.snap_name}: ${e.label} (bekreft)`}
                aria-invalid={parseNorwegianAmount(dec[i].text) === "ugyldig"} onChange={ev => set(i, { text: ev.target.value })} />
            </div>
            <label className="mt-1 flex min-h-[44px] items-center gap-2">
              <Checkbox disabled={!editable} checked={dec[i].excluded} onCheckedChange={v => set(i, { excluded: v === true })} /> Utelat feltet
            </label>
            {dec[i].excluded && <Input className="h-12" disabled={!editable} placeholder="Begrunnelse (påkrevd)" aria-label={`${line.snap_name}: begrunnelse for å utelate «${e.label}»`} value={dec[i].exclude_reason} onChange={ev => set(i, { exclude_reason: ev.target.value })} />}
          </fieldset>
        ))}
      </div>
      {editable && !res.ok && <ul className="text-xs text-destructive" aria-label="Må avklares">{res.problems.map(x => <li key={x}>{x}</li>)}</ul>}
      {total != null && Number.isFinite(total) && <p>Sum ved bekreftelse: <strong>{formatAmount(total)} {line.snap_base_unit ?? ""}</strong></p>}
      {p.status === "foreslatt" && open && canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-[48px]" disabled={!canAccept} onClick={() => {
            const exclusions = p.entries.flatMap((e, i) => (decisions[i].excluded ? [{ label: e.label, reason: decisions[i].exclude_reason.trim() }] : []));
            const x: AccP = { state: total === 0 ? "null" : "talt", total: total ?? 0, entry: total === 0 ? [] : entry, exclusions };
            void acc.execute(x, JSON.stringify(x)).then(done);
          }}>{total === 0 ? "Bekreft 0 på lager" : "Bekreft verdien"}</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={acc.busy || rej.busy || !!acc.pending} onClick={() => {
            void rej.execute({ note: null }, "avvis").then(r => { setMsg(r.kind === "ok" ? "Avvist. Linjen er uendret." : r.kind === "rejected" || r.kind === "unknown" ? r.message : null); void qc.invalidateQueries({ queryKey: s3Keys.props(entity, p.job_id) }); });
          }}>Avvis forslaget</Button>
          {acc.pending && <Button variant="outline" className="min-h-[48px]" onClick={() => { const x = acc.pending?.payload as AccP | undefined; if (x) void acc.execute(x, JSON.stringify(x)).then(done); }}>Send samme bekreftelse på nytt</Button>}
        </div>
      )}
      {!docOk && p.status === "foreslatt" && <p className="text-xs">Kan ikke bekreftes: dokumentet er ikke identitetsbekreftet og komplett.</p>}
      {msg && <p aria-live="polite">{msg}</p>}
    </Card>
  );
}
