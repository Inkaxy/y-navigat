import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Download, Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VtRejectedError } from "../api";
import { useVtScope } from "../hooks";
import { formatKr } from "../logic";
import { pendingStoreFor, type PendingOp } from "../pendingStore";
import { downloadBlob } from "../report";
import { useStage3Api, type MailState, type ReportPreview } from "../stage3";
import { s3Keys, useStage3Ready } from "../stage3Hooks";
import type { VtCount } from "../types";
import { Notice } from "./shared";

export const MAIL_STATE_TEXT: Record<MailState, string> = {
  akseptert_av_tjenesten: "Akseptert av e-posttjenesten (Microsoft 365). Det bekrefter ikke at e-posten er levert hos mottakeren.",
  avvist: "E-posttjenesten avviste sendingen. Ingenting ble sendt.",
  ukjent: "Ukjent om e-posten ble sendt. Den sendes ikke automatisk på nytt — kontroller «Sendte elementer» i Outlook.",
  reservert: "Sendingen er registrert, men ikke startet. «Fullfør samme sending» sender de lagrede vedleggene én gang.",
  sender: "Sendingen ble startet, men utfallet er ukjent. Den sendes ikke på nytt — kontroller «Sendte elementer».",
};
interface SendP { countId: string; hash: string; recipient: string; subject: string; message: string }
/** Op-en fjernes bare ved kjent sluttutfall eller eksplisitt avstemming av brukeren. */
const resolved = (s: MailState) => s === "akseptert_av_tjenesten" || s === "avvist";

function useMailOp(userId: string | null, entity: string, countId: string) {
  const store = pendingStoreFor(userId, entity, "mail:v1");
  useSyncExternalStore(useCallback(fn => store.subscribe(fn), [store]), () => store.getVersion());
  return { store, key: `mail:${countId}`, op: store.get(`mail:${countId}`) as PendingOp<SendP & { lastState: MailState | null }> | undefined };
}
function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type });
}

/** Forhåndsvisning av nøyaktige vedlegg og eksplisitt sending. Ukjent utfall holdes holdbart per bruker/firma/telling. */
export function MailPanel({ count }: { count: VtCount }) {
  const api = useStage3Api(); const { entity, userId, canWrite } = useVtScope(); const s3 = useStage3Ready();
  const { store, key, op } = useMailOp(userId, entity, count.id);
  const ctx = useRef({ entity, userId, countId: count.id }); ctx.current = { entity, userId, countId: count.id };
  const [show, setShow] = useState(false);
  const preview = useQuery({ queryKey: s3Keys.preview(entity, `${count.id}:${count.revision}`), queryFn: () => (api ? api.previewReport(count.id) : Promise.reject(new Error("utilgjengelig"))), enabled: show && s3.ready && !!api && !op, retry: false });
  const [recipient, setRecipient] = useState(""); const [subject, setSubject] = useState<string | null>(null); const [message, setMessage] = useState("");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  if (!s3.ready) return <Notice title="Rapport på e-post er ikke tatt i bruk ennå.">Blir tilgjengelig når databasedelen og e-posttjenesten er godkjent og rullet ut. Bruk PDF/CSV i mellomtiden.</Notice>;

  const frozen = { entity, userId, countId: count.id };
  const same = () => ctx.current.entity === frozen.entity && ctx.current.userId === frozen.userId && ctx.current.countId === frozen.countId;
  const record = (state: MailState | null, o: PendingOp<SendP & { lastState: MailState | null }>) => {
    if (state && resolved(state)) store.remove(key, o.opId);
    else store.put({ ...o, state: "unknown", payload: { ...o.payload, lastState: state } });
  };
  const send = async (p: SendP) => {
    if (!api || !canWrite || !store.tryLock(key)) return;
    let o = store.get(key) as PendingOp<SendP & { lastState: MailState | null }> | undefined;
    const fresh = !o;
    try {
      if (!o) { o = { key, opId: crypto.randomUUID(), sig: JSON.stringify(p), payload: { ...p, lastState: null }, state: "inflight", at: new Date().toISOString() }; store.put(o); }
      setBusy(true);
      const r = await api.sendReport({ opId: o.opId, ...o.payload });
      record(r.state, o);
      if (same()) setMsg(MAIL_STATE_TEXT[r.state] + (r.replayed ? " (lagret utfall — ingenting sendt på nytt)" : ""));
    } catch (e) {
      // Kjent avvisning fra serveren skjer bare FØR reservasjon (ingenting lagret/sendt) ⇒ trygt å fjerne op-en.
      // Ved gjenopptak kan en reservasjon finnes på serveren ⇒ behold op-en (ukjent) selv ved avvisning.
      if (o && fresh && e instanceof VtRejectedError) { store.remove(key, o.opId); if (same()) setMsg(e.message); }
      else if (o) { record(o.payload.lastState ?? "ukjent", o); if (same()) setMsg(MAIL_STATE_TEXT.ukjent); }
    } finally { store.unlock(key); setBusy(false); }
  };
  const checkStatus = async () => {
    if (!api || !op) return; setBusy(true);
    try {
      const r = await api.mailStatus(op.opId); // skrivebeskyttet
      if (!same()) return;
      if (!r.found) { setMsg("Serveren har ingen registrering av denne sendingen. Ingenting er sendt. Du kan forkaste den lokale registreringen."); store.put({ ...op, payload: { ...op.payload, lastState: null } }); return; }
      if (r.state) { record(r.state, op); setMsg(MAIL_STATE_TEXT[r.state] + (r.detail ? ` (${r.detail})` : "")); }
    } catch { if (same()) setMsg("Kunne ikke hente status. Utfallet er fortsatt ukjent — ingenting er sendt på nytt herfra."); } finally { setBusy(false); }
  };

  if (op) {
    const st = op.payload.lastState;
    return (
      <Card className="space-y-2 p-4" aria-label="Rapport på e-post — uavklart sending">
        <p className="font-medium">E-postsending til {op.payload.recipient} er ikke avklart</p>
        <p className="text-sm" role="alert">{st ? MAIL_STATE_TEXT[st] : "Svaret kom ikke fram. Kontroller status før noe annet."}</p>
        {store.lastError && <p className="text-sm text-destructive">{store.lastError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-[48px]" disabled={busy} onClick={() => void checkStatus()}>Sjekk status (sender ikke)</Button>
          {st === "reservert" && <Button className="min-h-[48px]" disabled={busy || !canWrite} onClick={() => void send(op.payload)}>Fullfør samme sending</Button>}
          <Button variant="ghost" className="min-h-[48px]" disabled={busy} onClick={() => {
            if (window.confirm("Bekreft at du har kontrollert «Sendte elementer» i Outlook. Den lokale registreringen fjernes; ingenting sendes.")) { store.remove(key, op.opId); setMsg("Lokal registrering fjernet etter kontroll."); }
          }}>Jeg har kontrollert — fjern</Button>
        </div>
        {msg && <p className="text-sm" aria-live="polite">{msg}</p>}
      </Card>
    );
  }
  if (!show) return (<div className="space-y-1">
    <Button variant="outline" className="min-h-[48px]" onClick={() => setShow(true)}><Mail className="h-4 w-4" aria-hidden /> Send rapport på e-post …</Button>
    {msg && <p className="text-sm" aria-live="polite">{msg}</p>}</div>);
  if (preview.isLoading) return <p className="text-sm">Lager forhåndsvisning fra lagrede verdier …</p>;
  if (preview.error || !preview.data) return <Notice tone="danger" title="Kunne ikke lage forhåndsvisning.">{preview.error instanceof Error ? preview.error.message : ""}</Notice>;
  const pv: ReportPreview = preview.data; const subj = subject ?? pv.defaultSubject;
  const p: SendP = { countId: count.id, hash: pv.hash, recipient: recipient.trim(), subject: subj.trim(), message };

  return (
    <Card className="space-y-3 p-4" aria-label="Rapport på e-post">
      <h3 className="font-medium">Rapport på e-post — forhåndsvisning</h3>
      <p className="text-sm">{pv.final ? "Endelig rapport" : "FORELØPIG rapport — tellingen er ikke avsluttet"} · tellingsrevisjon {pv.countRevision} · versjon {pv.hash.slice(0, 12)}</p>
      <ul className="text-sm">
        <li>Verdi: {pv.totals.value == null ? "ukjent" : formatKr(pv.totals.value)}{pv.totals.complete ? "" : " (ufullstendig)"}</li>
        {pv.totals.countedWithoutPrice > 0 && <li className="text-destructive">{pv.totals.countedWithoutPrice} talte varer uten pris</li>}
        <li>{pv.totals.notCounted} ikke talt · {pv.totals.review} må kontrolleres · {pv.totals.lines} linjer</li>
      </ul>
      <div className="flex flex-wrap gap-2" aria-label="Vedlegg som sendes">
        <Button variant="outline" className="min-h-[44px]" onClick={() => downloadBlob(new Blob([pv.csv], { type: "text/csv;charset=utf-8" }), `${pv.attachmentBase}.csv`)}><Download className="h-4 w-4" aria-hidden /> {pv.attachmentBase}.csv</Button>
        {pv.pdfB64 ? <Button variant="outline" className="min-h-[44px]" onClick={() => downloadBlob(b64ToBlob(pv.pdfB64, "application/pdf"), `${pv.attachmentBase}.pdf`)}><Download className="h-4 w-4" aria-hidden /> {pv.attachmentBase}.pdf</Button>
          : <span className="text-sm text-muted-foreground">PDF-vedlegget lages av serveren (ikke i demonstrasjonen).</span>}
        <Button variant="ghost" className="min-h-[44px]" onClick={() => setCsvOpen(v => !v)}>{csvOpen ? "Skjul" : "Vis"} CSV-innhold</Button>
      </div>
      {csvOpen && <pre className="max-h-64 overflow-auto rounded border p-2 text-xs" aria-label="CSV-vedlegg">{pv.csv.replace(/^\uFEFF/, "")}</pre>}
      {pv.mailConfigured && pv.sender && <p className="text-sm" data-testid="vt-mail-sender">Sendes fra: <strong className="break-all">{pv.sender}</strong> (tilkoblet Microsoft 365-postboks)</p>}
      {!pv.mailConfigured && <Notice tone="warning" title="E-postsending er ikke satt opp.">Microsoft 365-postboksen er ikke koblet til. Ingenting kan sendes herfra; last ned vedleggene i stedet.</Notice>}
      <div className="grid gap-2">
        <div><Label htmlFor={`vt-mail-to-${count.id}`}>Mottaker (én adresse)</Label><Input id={`vt-mail-to-${count.id}`} type="email" className="h-12" value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
        <div><Label htmlFor={`vt-mail-subj-${count.id}`}>Emne</Label><Input id={`vt-mail-subj-${count.id}`} className="h-12" value={subj} onChange={e => setSubject(e.target.value)} maxLength={200} /></div>
        <div><Label htmlFor={`vt-mail-msg-${count.id}`}>Melding</Label><Textarea id={`vt-mail-msg-${count.id}`} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[48px]" disabled={!pv.mailConfigured || !canWrite || busy || !p.recipient || !p.subject} onClick={() => void send(p)}>Send</Button>
        <Button variant="outline" className="min-h-[48px]" onClick={() => { setShow(false); setMsg(null); }}>Lukk</Button>
      </div>
      {msg && <p className="text-sm" aria-live="polite">{msg}</p>}
    </Card>
  );
}
