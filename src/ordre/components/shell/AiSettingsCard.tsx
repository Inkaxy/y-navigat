import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sparkles, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  useOrdreAiSettings,
  MODEL_OPTIONS,
  type AiProvider,
} from "@/ordre/hooks/useOrdreAiSettings";

export function AiSettingsCard() {
  const { settings, secrets, loading, saving, save } = useOrdreAiSettings();
  const { toast } = useToast();
  const [draft, setDraft] = useState<typeof settings | null>(null);

  const cur = draft ?? settings;
  const dirty = !!draft;

  const handleProvider = (p: AiProvider) => {
    const models = MODEL_OPTIONS[p];
    setDraft({
      ...cur,
      provider: p,
      models: {
        main: models[0],
        screening: models[models.length - 1],
      },
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      await save(draft);
      setDraft(null);
      toast({ title: "AI-innstillinger lagret" });
    } catch (e: any) {
      toast({ title: "Lagring feilet", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI-analyse av tickets
        </CardTitle>
        <CardDescription>
          Velg hvilken provider og modell som skal foreslå ordre fra innkommende e-post.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Laster …</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Provider</Label>
              <RadioGroup
                value={cur.provider}
                onValueChange={(v) => handleProvider(v as AiProvider)}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="anthropic" id="prov-ant" />
                  <Label htmlFor="prov-ant" className="font-normal">Anthropic (Claude)</Label>
                  <SecretBadge ok={secrets?.anthropic} />
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="openai" id="prov-oai" />
                  <Label htmlFor="prov-oai" className="font-normal">OpenAI (GPT)</Label>
                  <SecretBadge ok={secrets?.openai} />
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hovedmodell</Label>
                <Select
                  value={cur.models.main}
                  onValueChange={(v) => setDraft({ ...cur, models: { ...cur.models, main: v } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS[cur.provider].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Screening-modell <span className="text-xs text-muted-foreground">(reservert for fremtid)</span></Label>
                <Select
                  value={cur.models.screening ?? cur.models.main}
                  onValueChange={(v) => setDraft({ ...cur, models: { ...cur.models, screening: v } })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS[cur.provider].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p><strong>API-nøkler</strong> settes som Supabase-secrets <code>ANTHROPIC_API_KEY</code> og <code>OPENAI_API_KEY</code>. De vises aldri i UI.</p>
              <p>Pris-tabell ligger i <code>platform_settings.ordre_ai.ai_pricing</code> og kan oppdateres uten redeploy.</p>
            </div>

            {dirty && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>Forkast</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Lagre AI-innstillinger
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SecretBadge({ ok }: { ok?: boolean }) {
  if (ok === undefined) return null;
  return ok ? (
    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Tilkoblet</Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300"><AlertCircle className="h-3 w-3" /> Mangler nøkkel</Badge>
  );
}
