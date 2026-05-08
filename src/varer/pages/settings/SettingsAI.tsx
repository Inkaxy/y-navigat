import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Provider = "lovable" | "openai" | "anthropic" | "custom";

interface ProviderConfig {
  provider: Provider;
  model: string;
  base_url?: string;
}

const DEFAULT_CONFIG: ProviderConfig = { provider: "lovable", model: "google/gemini-2.5-pro" };

const MODEL_HINTS: Record<Provider, string> = {
  lovable: "F.eks. google/gemini-2.5-pro, openai/gpt-5",
  openai: "F.eks. gpt-4o, gpt-5",
  anthropic: "F.eks. claude-3-5-sonnet-20241022, claude-sonnet-4-5-20250929",
  custom: "Modellnavnet din endpoint forventer",
};

export default function SettingsAI() {
  const [config, setConfig] = useState<ProviderConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("category", "varer_ai")
      .eq("key", "provider_config")
      .maybeSingle();
    if (error) {
      toast.error(error.message);
    } else if (data?.value) {
      setConfig(data.value as unknown as ProviderConfig);
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("platform_settings").upsert({
      category: "varer_ai",
      key: "provider_config",
      value: config as unknown as Record<string, unknown>,
      updated_by: u.user?.id,
    } as never, { onConflict: "category,key" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("AI-konfig lagret");
    }
  }

  if (loading) return <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI for PDF-tolking
          </CardTitle>
          <CardDescription>
            Brukes når du laster opp en deklarasjons-PDF på en vare. Lovable AI er default — ingen ekstra konfig nødvendig.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Provider</Label>
            <Select value={config.provider} onValueChange={(v) => setConfig({ ...config, provider: v as Provider })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lovable">Lovable AI (anbefalt)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="custom">Annet (OpenAI-kompatibel)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Modell</Label>
            <Input
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={MODEL_HINTS[config.provider]}
            />
            <p className="text-xs text-muted-foreground mt-1">{MODEL_HINTS[config.provider]}</p>
          </div>

          {config.provider === "custom" && (
            <div>
              <Label>Base URL</Label>
              <Input
                value={config.base_url ?? ""}
                onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                placeholder="https://min-ai-endpoint.no/v1"
              />
              <p className="text-xs text-muted-foreground mt-1">Endpoint må være OpenAI-kompatibel (chat/completions).</p>
            </div>
          )}

          {config.provider !== "lovable" && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="flex gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                <div>
                  Du må sette <code className="text-xs bg-muted px-1 rounded">CUSTOM_AI_API_KEY</code> som secret før dette virker.
                  Be Lovable-agenten om å legge til denne, eller administrer den i prosjektets secrets-innstillinger.
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lagre
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
