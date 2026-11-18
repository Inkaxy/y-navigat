import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { callPendingRpc } from "@/lib/pendingRpc";
import { formatDate } from "@/ravarer/lib/constants";
import { readingKeys, requireSaved, unwrapPending, useModelOptions, useReadingSettings } from "@/ravarer/lib/fakturalesing/readingApi";
import { READING_FEATURE_LABEL, READING_FEATURES, type ReadingFeature, type ReadingSettings } from "../../../../../supabase/pending/functions/_shared/readingSettings";

const HINT: Record<ReadingFeature, string> = {
  catalog: "Leseren får leverandørens kjente varer (varenummer, navn, skrivemåter, pakning) og velger kjent varenummer når teksten passer. Ukjente varenummer som ikke følger leverandørens mønster merkes.",
  profile: "Bekreftet leverandørprofil sendes med hver lesing for leverandøren.",
  learning: "Koblinger, «ikke vare», rettet pakning og rettede linjer lagres som eksempler, og de mest relevante sendes med neste lesing. Samlet gjenlesing blir aldri eksempel.",
  self_check: "Går ikke regnestykket eller summen opp, får leseren den konkrete feilen og ett nytt forsøk. Feiler det fortsatt, leses fakturaen med den sterkere modellen, og den beste lesingen etter sumkontroll beholdes.",
};
const NONE = "__ingen__";

/** Brytere for opplæringen. Alt er AV til det slås på og lagres. Kladd med Lagre/Avbryt. */
export function ReadingSwitchesCard({ legalEntityId }: { legalEntityId: string }) {
  const qc = useQueryClient();
  const q = useReadingSettings(legalEntityId);
  const models = useModelOptions(legalEntityId);
  const [draft, setDraft] = useState<ReadingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const base = q.data?.settings ?? null;
  // Kladden beholdes ved ny henting; den tas bare fra serveren når det ikke finnes noen.
  useEffect(() => { if (base && !draft) setDraft(base); }, [base, draft]);

  if (q.isError) return <QueryErrorState error={q.error} scope="fakturalesing-innstillinger" onRetry={() => void q.refetch()} title="Kunne ikke hente innstillingene for fakturalesing" />;
  if (!q.data || !draft) return <QueryLoadingState rows={4} />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data.settings);

  const save = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      requireSaved(unwrapPending(await callPendingRpc("rm_save_reading_settings", {
        p_legal_entity_id: legalEntityId, p_settings: draft, p_expected_revision: q.data.revision,
      })));
      const fresh = await q.refetch();
      if (fresh.data) setDraft(fresh.data.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lagringen feilet.");
      void qc.invalidateQueries({ queryKey: readingKeys.settings(legalEntityId) });
    } finally { busy.current = false; setSaving(false); }
  };

  return (
    <Card id="innst-fakturalesing-brytere">
      <CardHeader>
        <CardTitle>Opplæring av fakturaleseren</CardTitle>
        <CardDescription>
          Alt er av til du slår det på. {q.data.updatedAt ? `Sist lagret ${formatDate(q.data.updatedAt)}.` : "Aldri lagret."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {READING_FEATURES.map((f) => (
          <div key={f} className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <Label htmlFor={`fl-${f}`} className="text-sm font-medium">{READING_FEATURE_LABEL[f]}</Label>
              <p className="mt-1 text-caption text-muted-foreground">{HINT[f]}</p>
            </div>
            <Switch id={`fl-${f}`} checked={draft[f]} onCheckedChange={(v) => setDraft({ ...draft, [f]: v })} className="mt-1 shrink-0" />
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fl-strong">Sterkere modell ved selvkontroll</Label>
            <Select value={draft.strong_config_id ?? NONE} onValueChange={(v) => setDraft({ ...draft, strong_config_id: v === NONE ? null : v })}>
              <SelectTrigger id="fl-strong" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Ingen sterkere modell</SelectItem>
                {(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.model}{m.isActive ? " (i bruk nå)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {models.isError && <p className="text-caption text-destructive">Kunne ikke hente modellene fra AI-oppsettet.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fl-max">Høyst antall eksempler per lesing</Label>
            <Input id="fl-max" type="number" inputMode="numeric" min={1} max={20} className="min-h-[44px]" value={draft.max_examples}
              onChange={(e) => { const n = Number.parseInt(e.target.value, 10); if (Number.isInteger(n)) setDraft({ ...draft, max_examples: Math.min(20, Math.max(1, n)) }); }} />
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(q.data.settings); setError(null); }}>Avbryt</Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Lagre
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
