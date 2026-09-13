import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Loader2, Unplug, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";

interface ConfigState {
  configured: boolean;
  encryption_ready: boolean;
  model: string;
  daily_cap: number;
  style_notes: string;
  used_today: number;
  key_updated_at: string | null;
  instruction_version: string;
  model_options: string[];
}

export default function SettingsDeclarationAssistant() {
  const { data: isPlatformAdmin, isLoading: adminLoading } = usePlatformAdmin();
  const [state, setState] = useState<ConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [dailyCap, setDailyCap] = useState("25");
  const [styleNotes, setStyleNotes] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("declaration-assistant-config", {
      body: { action: "get" },
    });
    if (error) {
      setLoadError("Kunne ikke hente oppsettet.");
    } else {
      const c = data as ConfigState;
      setState(c);
      setModel(c.model);
      setDailyCap(String(c.daily_cap));
      setStyleNotes(c.style_notes ?? "");
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("declaration-assistant-config", {
      body: {
        action: "save",
        model,
        daily_cap: Number(dailyCap),
        style_notes: styleNotes,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      },
    });
    setSaving(false);
    if (error) {
      toast.error((data as { error?: string } | null)?.error ?? "Kunne ikke lagre. Forrige oppsett er beholdt.");
      return;
    }
    setApiKey("");
    toast.success("Oppsettet er lagret");
    void load();
  }

  async function disconnect() {
    const { error } = await supabase.functions.invoke("declaration-assistant-config", {
      body: { action: "disconnect" },
    });
    if (error) {
      toast.error("Kunne ikke koble fra");
      return;
    }
    toast.success("Nøkkelen er koblet fra. Assistenten er slått av.");
    void load();
  }

  if (adminLoading || loading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Bare plattformadministrator kan sette opp deklarasjonsassistenten. Kontakt en administrator.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5" /> Deklarasjonsassistent
          </CardTitle>
          <CardDescription>
            Hjelper med skrivemåte og kontrollpunkter i ingredienslister. Den lagrer og godkjenner aldri noe selv,
            og den er ikke en garanti for at etiketten er lovlig.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {state?.configured ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Tilkoblet
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Ikke satt opp — assistenten er slått av
              </Badge>
            )}
            {state && (
              <span className="text-xs text-muted-foreground">
                Brukt i dag: {state.used_today} av {state.daily_cap}
              </span>
            )}
          </div>

          {state && !state.encryption_ready && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Serveren mangler krypteringsnøkkelen <code>AI_CONFIG_ENCRYPTION_KEY</code>. API-nøkkelen kan ikke
                lagres trygt før den er lagt inn under prosjektets secrets. Assistenten holdes avslått til da.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label className="text-xs">OpenAI API-nøkkel</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={state?.configured ? "Lagret — fyll bare ut for å bytte nøkkel" : "sk-…"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Nøkkelen lagres kryptert på serveren og vises aldri igjen. Lar du feltet stå tomt, beholdes nøkkelen
              som allerede virker.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Modell</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(state?.model_options ?? ["gpt-4.1-mini", "gpt-4.1"]).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Maks antall kontroller per dag</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Stilnotater (valgfritt)</Label>
            <Textarea
              rows={3}
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="F.eks. «bruk alltid «gjær», ikke «bakegjær»»"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Stilnotater ligger alltid under de låste fagreglene og kan ikke overstyre dem.
              Instruksjonsversjon: <code>{state?.instruction_version}</code>
            </p>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={disconnect} disabled={!state?.configured}>
              <Unplug className="mr-1.5 h-4 w-4" /> Koble fra
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lagre
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Slik kommer du i gang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Lag en API-nøkkel hos OpenAI (platform.openai.com) og lim den inn over. Bare plattformadministrator kan gjøre dette.</p>
          <p>2. Bruk av API-en faktureres av OpenAI og er noe helt annet enn et ChatGPT-abonnement.</p>
          <p>3. Hver kontroll koster noen få øre. Dagsgrensen over er et tak som stopper bruken når den er nådd.</p>
          <p>4. Nøkkelen kan i prinsippet brukes til hva som helst hos OpenAI — det er NBhub-serveren som begrenser den til deklarasjonskontroll, ikke nøkkelen selv.</p>
          <p>5. Fakturatolkingen i Råvarer har sitt eget oppsett og påvirkes ikke av dette.</p>
        </CardContent>
      </Card>
    </div>
  );
}
