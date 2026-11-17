import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc, pendingInsert, pendingPatch } from "@/lib/pendingRpc";
import { parseStale, type AutoSettings, type StaleResult } from "@/ravarer/lib/automatikk";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { AUTO_KEY, useAutoSettings } from "./useAutomatikk";

const dateNo = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "–");

/**
 * Regler som krever databaseendringen for Automatikk: pant som følgevare og automatisk ny beregning av
 * gamle åpne fakturaer i begrensede bolker. Før SQL er kjørt vises de som «venter».
 */
export function PendingRulesCard({ canEdit, canWrite }: { canEdit: boolean; canWrite: boolean }) {
  const st = useAutoSettings();
  if (st.cap !== true) {
    return (
      <section aria-labelledby="nye-regler" className="rounded-2xl border border-dashed border-line-subtle bg-card p-4">
        <h2 id="nye-regler" className="text-body font-semibold">Nye regler</h2>
        <ul className="mt-1 list-disc pl-5 text-sm text-ink-secondary">
          <li>Pant følger varen den hører til (utenfor kost, mva-fri, aldri utelatt).</li>
          <li>Gamle åpne fakturaer beregnes på nytt automatisk, noen få om gangen.</li>
        </ul>
        <p className="mt-2 text-caption text-ink-secondary">{st.cap === false ? "Venter på databaseendringen for Automatikk." : "Sjekker om databaseendringen er kjørt …"}</p>
      </section>
    );
  }
  if (st.isError) return <p role="alert" className="text-sm text-destructive">De nye reglene kunne ikke leses.</p>;
  if (!st.data) return <p className="text-sm text-ink-secondary">Henter de nye reglene …</p>;
  return <Editor key={JSON.stringify(st.data)} value={st.data} canEdit={canEdit} canWrite={canWrite} />;
}

function Editor({ value, canEdit, canWrite }: { value: AutoSettings; canEdit: boolean; canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [d, setD] = useState(value);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(value);
  const valid = Number.isInteger(d.batch) && d.batch >= 1 && d.batch <= 100 && Number.isInteger(d.minAgeDays) && d.minAgeDays >= 1 && d.minAgeDays <= 60;

  const save = async () => {
    if (lock.current || !company || !dirty || !valid) return;
    lock.current = true; setBusy(true); setMsg(null);
    try {
      const body = { deposit_as_follow_item: d.depositFollows, auto_requeue_stale_enabled: d.requeueOn, auto_requeue_batch_size: d.batch, auto_requeue_min_age_days: d.minAgeDays };
      let r = await pendingPatch("invoice_match_settings", `legal_entity_id=eq.${company.id}`, body);
      if (r.kind === "ok" && Array.isArray(r.data) && r.data.length === 0) r = await pendingInsert("invoice_match_settings", { legal_entity_id: company.id, ...body });
      if (r.kind === "ok") { setMsg({ ok: true, text: "Lagret." }); void qc.invalidateQueries({ queryKey: [...AUTO_KEY, "innstillinger"] }); }
      else setMsg({ ok: false, text: r.kind === "denied" ? "Bare administrator kan endre dette." : "Utfallet er ukjent. Hent siden på nytt og kontroller." });
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <section aria-labelledby="nye-regler" className="space-y-3 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id="nye-regler" className="text-body font-semibold">Pant og gamle fakturaer</h2>
      <ul className="divide-y divide-line-subtle">
        <li className="flex items-start justify-between gap-4 py-3">
          <div><p className="text-sm font-medium">Pant følger varen den hører til.</p><p className="text-caption text-ink-secondary">Utenfor kost, mva-fri, aldri utelatt. Pant med egen prishistorikk flyttes ikke uten egen godkjenning.</p></div>
          <Switch checked={d.depositFollows} disabled={!canEdit || busy} aria-label="Pant følger varen" onCheckedChange={(v) => setD({ ...d, depositFollows: v })} />
        </li>
        <li className="space-y-2 py-3">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm font-medium">Gamle åpne fakturaer beregnes på nytt automatisk, {d.batch} om gangen.</p><p className="text-caption text-ink-secondary">Bare fakturaer som ikke er beregnet de siste {d.minAgeDays} dagene. Eldste først. Én gang i timen.</p></div>
            <Switch checked={d.requeueOn} disabled={!canEdit || busy} aria-label="Automatisk ny beregning" onCheckedChange={(v) => setD({ ...d, requeueOn: v })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="auto-bolk">Antall om gangen (1–100)</Label>
              <Input id="auto-bolk" inputMode="numeric" className="h-11" disabled={!canEdit || busy} value={String(d.batch)} onChange={(e) => setD({ ...d, batch: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
            <div className="space-y-1"><Label htmlFor="auto-alder">Ikke beregnet på (dager, 1–60)</Label>
              <Input id="auto-alder" inputMode="numeric" className="h-11" disabled={!canEdit || busy} value={String(d.minAgeDays)} onChange={(e) => setD({ ...d, minAgeDays: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          </div>
          <p className="text-caption text-ink-secondary">Den timevise kjøringen må også slås på av root (egen fil). Til da kan du kjøre en bolk selv under.</p>
        </li>
      </ul>
      {!valid && <p role="alert" className="text-caption text-destructive">Antall må være 1–100 og dager 1–60.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-caption" : "text-caption text-destructive"}>{msg.text}</p>}
      {canEdit && <div className="flex gap-2">
        <Button className="min-h-[44px]" disabled={!dirty || !valid || busy} onClick={() => void save()}>Lagre</Button>
        <Button variant="ghost" className="min-h-[44px]" disabled={!dirty || busy} onClick={() => setD(value)}>Forkast</Button>
      </div>}
      <ManualRuns canWrite={canWrite} limit={value.batch} />
    </section>
  );
}

type Run = { kind: "idle" } | { kind: "busy" } | { kind: "preview"; r: Extract<StaleResult, { kind: "ok" }> } | { kind: "done"; text: string } | { kind: "error"; text: string };

/** Manuell bolk: vis hvilke som står for tur, kjør så samme antall. Pant-merking: forhåndsvisning, så merking. */
function ManualRuns({ canWrite, limit }: { canWrite: boolean; limit: number }) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [pant, setPant] = useState<{ n: number; text: string } | null>(null);
  const lock = useRef(false);
  const le = company?.id ?? null;
  const stale = async (dry: boolean) => {
    if (lock.current || !le) return;
    lock.current = true; setRun({ kind: "busy" });
    try {
      const r = await callPendingRpc("rm_requeue_stale_open_invoices", { p_legal_entity_id: le, p_limit: limit, p_dry_run: dry });
      const p = r.kind === "ok" ? parseStale(r.data) : null;
      if (!p || p.kind !== "ok") { setRun({ kind: "error", text: r.kind === "denied" ? "Du har ikke skrivetilgang." : dry ? "Listen kunne ikke hentes." : "Utfallet er ukjent. Se køstatus før du kjører igjen." }); return; }
      if (dry) setRun({ kind: "preview", r: p });
      else { setRun({ kind: "done", text: `${p.queued} ${p.queued === 1 ? "faktura er" : "fakturaer er"} lagt i kø for ny beregning.` }); invalidateInvoice(qc); }
    } finally { lock.current = false; }
  };
  const markPant = async (dry: boolean) => {
    if (lock.current || !le) return;
    lock.current = true;
    try {
      const r = await callPendingRpc("rm_mark_deposit_follow_items", { p_legal_entity_id: le, p_invoice_ids: null, p_limit: 200, p_dry_run: dry });
      const o = r.kind === "ok" && r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
      const n = o && o.ok === true && typeof o.marked === "number" ? o.marked : null;
      if (n == null) { setPant({ n: 0, text: dry ? "Forhåndsvisningen kunne ikke leses." : "Utfallet er ukjent. Se fakturaene før du prøver igjen." }); return; }
      setPant(dry ? { n, text: n === 0 ? "Ingen åpne pantlinjer å merke." : `${n} åpne pantlinjer kan merkes som følgevare.` } : { n: 0, text: `${n} pantlinjer er merket som følgevare.` });
      if (!dry) invalidateInvoice(qc);
    } finally { lock.current = false; }
  };
  if (!canWrite) return <p className="text-caption text-ink-secondary">Manuell kjøring krever skrivetilgang.</p>;
  return (
    <div className="space-y-3 border-t border-line-subtle pt-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">Kjør en bolk nå</p>
        {run.kind === "preview" ? (
          <>
            <p className="text-sm">{run.r.candidates.length === 0 ? "Ingen gamle åpne fakturaer står for tur." : `${run.r.candidates.length} fakturaer står for tur (eldste først):`}</p>
            {run.r.candidates.length > 0 && <ul className="max-h-40 overflow-auto text-caption tabular-nums">{run.r.candidates.map((c) => <li key={c.id}>{c.invoiceNumber ?? "Uten nummer"} · {dateNo(c.invoiceDate)} · sist beregnet {dateNo(c.lastRun)}</li>)}</ul>}
            <div className="flex gap-2">
              <Button className="min-h-[44px]" disabled={run.r.candidates.length === 0} onClick={() => void stale(false)}>Legg i kø</Button>
              <Button variant="ghost" className="min-h-[44px]" onClick={() => setRun({ kind: "idle" })}>Avbryt</Button>
            </div>
          </>
        ) : <Button variant="outline" className="min-h-[44px]" disabled={run.kind === "busy"} onClick={() => void stale(true)}>Vis hvilke som står for tur</Button>}
        {(run.kind === "done" || run.kind === "error") && <p role={run.kind === "done" ? "status" : "alert"} className={run.kind === "error" ? "text-caption text-destructive" : "text-caption"}>{run.text}</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Merk åpne pantlinjer som følgevare</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => void markPant(true)}>Se hvor mange</Button>
          {pant && pant.n > 0 && <Button className="min-h-[44px]" onClick={() => void markPant(false)}>Merk {pant.n}</Button>}
        </div>
        {pant && <p role="status" className="text-caption">{pant.text}</p>}
      </div>
    </div>
  );
}
