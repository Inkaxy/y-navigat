import { useState } from "react";
import { Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOpAction, useVtScope } from "../hooks";
import { formatKr } from "../logic";
import { useStage3Api, type MailState } from "../stage3";
import { s3Keys, useStage3Ready } from "../stage3Hooks";
import type { VtCount } from "../types";
import { Notice } from "./shared";

const STATE_TEXT: Record<MailState, string> = {
  akseptert_av_tjenesten: "Akseptert av e-posttjenesten (Microsoft 365). Det bekrefter ikke at e-posten er levert hos mottakeren.",
  avvist: "E-posttjenesten avviste sendingen. Ingenting ble sendt.",
  ukjent: "Ukjent om e-posten ble sendt. Den sendes ikke automatisk på nytt — kontroller «Sendte elementer» før du lager en ny sending.",
  reservert: "Sendingen er registrert, men ikke fullført.",
  sender: "Sendingen pågår eller ble avbrutt underveis — utfallet er ukjent og sendes ikke på nytt.",
};
interface SendP { countId: string; hash: string; countRevision: number; recipient: string; subject: string; message: string }

/** Forhåndsvisning av lagret rapportversjon og eksplisitt sending. Ingen automatisk sending. */
export function MailPanel({ count }: { count: VtCount }) {
  const api = useStage3Api(); const { entity, canWrite } = useVtScope(); const s3 = useStage3Ready();
  const [show, setShow] = useState(false);
  const preview = useQuery({ queryKey: s3Keys.preview(entity, `${count.id}:${count.revision}`), queryFn: () => (api ? api.previewReport(count.id) : Promise.reject(new Error("utilgjengelig"))), enabled: show && s3.ready && !!api, retry: false });
  const [recipient, setRecipient] = useState(""); const [subject, setSubject] = useState<string | null>(null); const [message, setMessage] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const send = useOpAction(`mail:${count.id}`, "write", (opId, p: SendP) => (api ? api.sendReport({ opId, ...p }) : Promise.reject(new Error("utilgjengelig"))));

  if (!s3.ready) return <Notice title="Rapport på e-post er ikke tatt i bruk ennå.">Blir tilgjengelig når databasedelen og e-posttjenesten er godkjent og rullet ut. Bruk PDF/CSV i mellomtiden.</Notice>;
  if (!show) return <Button variant="outline" className="min-h-[48px]" onClick={() => setShow(true)}><Mail className="h-4 w-4" aria-hidden /> Send rapport på e-post …</Button>;
  if (preview.isLoading) return <p className="text-sm">Lager forhåndsvisning fra lagrede verdier …</p>;
  if (preview.error || !preview.data) return <Notice tone="danger" title="Kunne ikke lage forhåndsvisning.">{preview.error instanceof Error ? preview.error.message : ""}</Notice>;
  const pv = preview.data; const subj = subject ?? pv.defaultSubject;
  const p: SendP = { countId: count.id, hash: pv.hash, countRevision: pv.countRevision, recipient: recipient.trim(), subject: subj.trim(), message };
  const run = (x: SendP) => void send.execute(x, JSON.stringify(x)).then(r => {
    if (r.kind === "ok") setResult(STATE_TEXT[r.value.state] + (r.value.replayed ? " (tidligere registrert utfall — ikke sendt på nytt)" : ""));
    else if (r.kind === "rejected" || r.kind === "unknown") setResult(r.message);
  });

  return (
    <Card className="space-y-3 p-4" aria-label="Rapport på e-post">
      <h3 className="font-medium">Rapport på e-post — forhåndsvisning</h3>
      <p className="text-sm">{pv.final ? "Endelig rapport" : "FORELØPIG rapport — tellingen er ikke avsluttet"} · tellingsrevisjon {pv.countRevision} · versjon {pv.hash.slice(0, 12)}</p>
      <ul className="text-sm">
        <li>Verdi med pris: {formatKr(pv.totals.valued)}</li>
        {pv.totals.unpricedPositive > 0 && <li className="text-destructive">{pv.totals.unpricedPositive} talte varer uten pris — verdien er ufullstendig</li>}
        <li>{pv.totals.uncounted} ikke talt · {pv.totals.review} må kontrolleres · {pv.totals.lines} linjer</li>
        <li>Vedlegg: {pv.attachments.join(", ")}</li>
      </ul>
      {!pv.mailConfigured && <Notice tone="warning" title="E-postsending er ikke konfigurert.">Microsoft 365-avsender for tellerapporter mangler. Ingenting kan sendes herfra; last ned PDF/CSV i stedet.</Notice>}
      <div className="grid gap-2">
        <div><Label htmlFor={`vt-mail-to-${count.id}`}>Mottaker (én adresse)</Label><Input id={`vt-mail-to-${count.id}`} type="email" className="h-12" value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
        <div><Label htmlFor={`vt-mail-subj-${count.id}`}>Emne</Label><Input id={`vt-mail-subj-${count.id}`} className="h-12" value={subj} onChange={e => setSubject(e.target.value)} maxLength={200} /></div>
        <div><Label htmlFor={`vt-mail-msg-${count.id}`}>Melding</Label><Textarea id={`vt-mail-msg-${count.id}`} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[48px]" disabled={!pv.mailConfigured || !canWrite || send.busy || !!send.pending || !p.recipient || !p.subject} onClick={() => run(p)}>Send</Button>
        <Button variant="outline" className="min-h-[48px]" onClick={() => { setShow(false); setResult(null); }}>Lukk</Button>
        {send.pending && <Button variant="outline" className="min-h-[48px]" onClick={() => { const x = send.pending?.payload as SendP | undefined; if (x) run(x); }}>Hent utfallet (samme sending)</Button>}
      </div>
      {send.pending && <p className="text-sm text-destructive" role="alert">Forrige sending har ukjent utfall. «Hent utfallet» bruker samme sending og sender aldri en ny e-post.</p>}
      {result && <p className="text-sm" aria-live="polite">{result}</p>}
    </Card>
  );
}
