// Råvarer › Innstillinger › Fakturalesing: bryteren «EHF først» (invoice_reading_settings.ehf_first).
// Egen kladd med Lagre/Avbryt; lagres bare via rm_save_ehf_first (godkjenner/admin, revisjon, revisjonslogg).
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { callPendingRpc } from "@/lib/pendingRpc";
import { EHF_SWITCH_WAITING, readingKeys, requireSaved, unwrapPending, useReadingSettings } from "@/ravarer/lib/fakturalesing/readingApi";

export function EhfFirstCard({ legalEntityId }: { legalEntityId: string }) {
  const qc = useQueryClient();
  const q = useReadingSettings(legalEntityId);
  const [draft, setDraft] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const base = q.data?.ehfFirst ?? null;
  // Kladden beholdes ved ny henting; den tas bare fra serveren når det ikke finnes noen.
  useEffect(() => { if (base !== null && draft === null) setDraft(base); }, [base, draft]);

  if (q.isError) return <QueryErrorState error={q.error} scope="fakturalesing-ehf-forst" onRetry={() => void q.refetch()} title="Kunne ikke hente bryteren for EHF" />;
  if (!q.data) return <QueryLoadingState rows={2} />;
  const waiting = q.data.ehfFirst === null;
  const value = draft ?? false;
  const dirty = !waiting && draft !== null && draft !== q.data.ehfFirst;

  const save = async () => {
    if (busy.current || draft === null) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      requireSaved(unwrapPending(await callPendingRpc("rm_save_ehf_first", {
        p_legal_entity_id: legalEntityId, p_enabled: draft, p_expected_revision: q.data.revision,
      })));
      const fresh = await q.refetch();
      if (fresh.data) setDraft(fresh.data.ehfFirst);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lagringen feilet.");
      void qc.invalidateQueries({ queryKey: readingKeys.settings(legalEntityId) });
    } finally { busy.current = false; setSaving(false); }
  };

  return (
    <Card id="innst-fakturalesing-ehf-forst">
      <CardHeader>
        <CardTitle>EHF først</CardTitle>
        <CardDescription>
          {waiting ? EHF_SWITCH_WAITING : q.data.ehfFirst ? "På: nye fakturaer fra Tripletex leses fra EHF når den finnes." : "Av: alle fakturaer leses fra PDF som før."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="min-w-0">
            <Label htmlFor="fl-ehf-first" className="text-sm font-medium">Les linjene fra EHF når den finnes</Label>
            <p className="mt-1 text-caption text-muted-foreground">
              Fakturaer fra Tripletex med EHF får varenummer, mengde, pris og rabatt rett fra EHF-filen i stedet for at PDF-en leses.
              EHF brukes bare når alle linjene har sum og summene stemmer med fakturaen; ellers leses PDF-en som før.
              Gjelder bare fakturaer som leses inn etter at bryteren er slått på. PDF-en lagres alltid for visning.
            </p>
          </div>
          <Switch id="fl-ehf-first" checked={value} disabled={waiting || saving} onCheckedChange={(v) => setDraft(v)} className="mt-1 shrink-0" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(q.data.ehfFirst); setError(null); }}>Avbryt</Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Lagre
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
