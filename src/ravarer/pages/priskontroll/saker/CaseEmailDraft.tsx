import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { buildSupplierCaseDraft, OUTBOX_LABEL, outboxState, type DraftInput } from "@/fakturaer/lib/supplierCaseDraft";

const errText = (m: string) => (/forbidden|42501/.test(m) ? "Du mangler skrivetilgang til fakturaer." : /emne|tekst/.test(m) ? "Emne og tekst må fylles ut." : "Kunne ikke lagre. Prøv igjen.");

/**
 * Redigerbar e-postkladd for saken. «Send kladd til Henrik» legger en intern
 * e-post i køen til en fast mottaker som bestemmes på serveren — aldri til leverandøren.
 */
export function CaseEmailDraft({ caseId, input, canWrite }: { caseId: string; input: DraftInput; canWrite: boolean }) {
  const qc = useQueryClient();
  const generated = useMemo(() => buildSupplierCaseDraft(input), [input]);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const inFlight = useRef(false);
  const s = subject ?? generated.subject;
  const b = body ?? generated.body;

  const list = useQuery({
    queryKey: ["supplier-case-drafts", caseId],
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => outboxState(d.outbox_status) === "i_ko") ? 15_000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("supplier_case_email_drafts_list", { p_case_id: caseId });
      if (error) throw new Error("Kunne ikke hente kladdene");
      return data ?? [];
    },
  });
  const latest = list.data?.[0];
  const dirty = !latest || latest.subject !== s || latest.body !== b;

  const save = async (): Promise<string> => {
    const { data, error } = await supabase.rpc("supplier_case_save_email_draft", { p_case_id: caseId, p_subject: s, p_body: b, p_missing_basis: generated.missingBasis });
    if (error) throw new Error(errText(error.message));
    const id = data && typeof data === "object" && !Array.isArray(data) && typeof data.draft_id === "string" ? data.draft_id : null;
    if (!id) throw new Error("Kunne ikke lagre. Prøv igjen.");
    return id;
  };

  const saveM = useMutation({
    mutationFn: save,
    onSuccess: () => setMsg({ text: "Ny kladdversjon lagret." }),
    onError: (e: Error) => setMsg({ text: e.message, error: true }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["supplier-case-drafts", caseId] }),
  });

  const sendM = useMutation({
    mutationFn: async () => {
      const draftId = dirty || !latest ? await save() : latest.id;
      const { data, error } = await supabase.rpc("supplier_case_queue_draft_to_henrik", { p_draft_id: draftId });
      if (error) throw new Error(errText(error.message));
      return data && typeof data === "object" && !Array.isArray(data) && data.already === true;
    },
    onSuccess: (already) => setMsg({ text: already ? "Denne versjonen ligger allerede i køen. Ingen ny e-post lagt til." : "Kladden er lagt i kø til Henrik. Den er ikke sendt til leverandøren." }),
    onError: (e: Error) => setMsg({ text: e.message, error: true }),
    onSettled: () => { inFlight.current = false; void qc.invalidateQueries({ queryKey: ["supplier-case-drafts", caseId] }); void qc.invalidateQueries({ queryKey: ["audit-history"] }); },
  });

  const busy = saveM.isPending || sendM.isPending;
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">E-postkladd til leverandøren</h3>
      <p className="text-caption text-ink-secondary">Kladden sendes bare internt til Henrik for gjennomgang. Han videresender selv. Saken markeres ikke som sendt til leverandøren.</p>
      {generated.missingBasis && <p role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Noen linjer mangler dokumentert avtalt pris. Det står ærlig i kladden.</p>}
      <div>
        <Label htmlFor="kladd-emne" className="mb-1 block">Emne</Label>
        <Input id="kladd-emne" value={s} onChange={(e) => setSubject(e.target.value)} disabled={!canWrite} maxLength={300} />
      </div>
      <div>
        <Label htmlFor="kladd-tekst" className="mb-1 block">Tekst</Label>
        <Textarea id="kladd-tekst" value={b} onChange={(e) => setBody(e.target.value)} disabled={!canWrite} rows={14} className="font-mono text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!canWrite || busy || !dirty} onClick={() => saveM.mutate()}>Lagre kladd</Button>
        <Button disabled={!canWrite || busy || !s.trim() || !b.trim()} onClick={() => { if (inFlight.current) return; inFlight.current = true; sendM.mutate(); }}>
          {sendM.isPending ? "Legger i kø …" : "Send kladd til Henrik"}
        </Button>
        {(subject != null || body != null) && <Button variant="ghost" disabled={busy} onClick={() => { setSubject(null); setBody(null); }}>Lag ny fra saken</Button>}
      </div>
      {msg && <p role={msg.error ? "alert" : "status"} className={msg.error ? "text-sm text-destructive" : "text-sm"}>{msg.text}</p>}
      {(list.data ?? []).length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Kladdversjoner">
          {(list.data ?? []).map((d) => {
            const st = outboxState(d.outbox_status);
            return (
              <li key={d.id} className="flex flex-wrap justify-between gap-2">
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => { setSubject(d.subject); setBody(d.body); }}>
                  Versjon {d.version} · {format(new Date(d.created_at), "EEE d. MMM yyyy, HH:mm", { locale: nb })}
                </button>
                <span className={st === "feilet" ? "text-destructive" : "text-ink-secondary"}>
                  {OUTBOX_LABEL[st]}{st === "sendt" && d.sent_at ? ` ${format(new Date(d.sent_at), "d. MMM HH:mm", { locale: nb })}` : ""}{st === "feilet" ? ` etter ${d.attempt_count ?? 0} forsøk` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list.isError && <p className="text-sm text-destructive">Kunne ikke hente kladdene. <button type="button" className="underline" onClick={() => void list.refetch()}>Prøv igjen</button></p>}
    </section>
  );
}
