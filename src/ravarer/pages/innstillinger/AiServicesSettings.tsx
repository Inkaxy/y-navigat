import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info, CheckCircle2, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Provider = "anthropic" | "openai" | "azure_openai";

interface AiConfig {
  id: string;
  provider: Provider;
  model: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  purpose: string;
  azure_endpoint: string | null;
  azure_deployment: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageEntry {
  provider: string;
  model: string;
  purpose: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  success: boolean;
  created_at: string;
}

const MODELS: Record<Provider, { value: string; label: string; recommended?: boolean }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", recommended: true },
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (raskere/billigere)" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o", recommended: true },
    { value: "gpt-4o-mini", label: "GPT-4o mini (billigere)" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
  azure_openai: [
    { value: "gpt-4o", label: "GPT-4o (Azure deployment)" },
    { value: "gpt-4o-mini", label: "GPT-4o-mini (Azure deployment)" },
  ],
};

export default function AiServicesSettings() {
  const qc = useQueryClient();

  const configs = useQuery({
    queryKey: ["ai-configs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "list" } });
      if (error) throw error;
      return (data as { configs: AiConfig[] }).configs;
    },
  });

  const usage = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "usage_summary" } });
      if (error) throw error;
      return (data as { entries: UsageEntry[] }).entries;
    },
  });

  const invoiceConfig = configs.data?.find((c) => c.purpose === "invoice_extraction" && c.is_active);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
          AI-tjenester
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Koble til ekstern AI-leverandør for fakturaekstraksjon og andre AI-funksjoner.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Bruk din egen AI-API</AlertTitle>
        <AlertDescription className="text-sm mt-2">
          Konfigurer din egen AI-leverandør for full kontroll på kostnader og kvalitet.
          Anbefalt modell for fakturaekstraksjon: <b>Claude Sonnet 4.5</b> (best ytelse på norske dokumenter)
          eller <b>GPT-4o</b> (lavere kostnad).
        </AlertDescription>
      </Alert>

      <ExtractionConfigCard
        existing={invoiceConfig ?? null}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["ai-configs"] }); }}
      />

      <UsageSummaryCard entries={usage.data ?? []} loading={usage.isLoading} />
    </div>
  );
}

function ExtractionConfigCard({ existing, onSaved }: { existing: AiConfig | null; onSaved: () => void }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>(existing?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(existing?.model ?? "claude-sonnet-4-5");
  const [maxTokens, setMaxTokens] = useState(existing?.max_tokens ?? 2000);
  const [temperature, setTemperature] = useState(existing?.temperature ?? 0.1);
  const [azureEndpoint, setAzureEndpoint] = useState(existing?.azure_endpoint ?? "");
  const [azureDeployment, setAzureDeployment] = useState(existing?.azure_deployment ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (existing) {
      setProvider(existing.provider);
      setModel(existing.model);
      setMaxTokens(existing.max_tokens);
      setTemperature(Number(existing.temperature));
      setAzureEndpoint(existing.azure_endpoint ?? "");
      setAzureDeployment(existing.azure_deployment ?? "");
    }
  }, [existing?.id]);

  // Reset model when provider changes (if not in list)
  useEffect(() => {
    const models = MODELS[provider];
    if (!models.some((m) => m.value === model)) {
      setModel(models[0].value);
    }
  }, [provider]);

  const test = async () => {
    if (!apiKey && !existing) {
      toast.error("Lim inn API-key først");
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-config-test", {
        body: {
          provider,
          api_key: apiKey || undefined, // tom = test lagret nøkkel
          model,
          purpose: "invoice_extraction",
          azure_endpoint: provider === "azure_openai" ? azureEndpoint : undefined,
          azure_deployment: provider === "azure_openai" ? azureDeployment : undefined,
        },
      });
      if (error) {
        // Forsøk å hente serverfeil-detaljer
        const ctxErr = (error as any)?.context;
        let detail = (error as any)?.message ?? String(error);
        try {
          const txt = await ctxErr?.text?.();
          if (txt) {
            const parsed = JSON.parse(txt);
            detail = parsed?.error ?? detail;
          }
        } catch { /* ignore */ }
        setTestResult({ ok: false, message: detail });
        return;
      }
      const r = data as { ok: boolean; sample_response?: string; error?: string };
      if (r.ok) {
        setTestResult({ ok: true, message: `OK — modellen svarte: ${r.sample_response}` });
      } else {
        setTestResult({ ok: false, message: r.error ?? "Ukjent feil" });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error("API-key er påkrevd");
      const { error } = await supabase.functions.invoke("ai-config", {
        body: {
          action: "save",
          provider, api_key: apiKey, model, max_tokens: maxTokens, temperature,
          purpose: "invoice_extraction",
          azure_endpoint: provider === "azure_openai" ? azureEndpoint : undefined,
          azure_deployment: provider === "azure_openai" ? azureDeployment : undefined,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("AI-konfigurasjon lagret");
      setApiKey("");
      onSaved();
    },
    onError: (e: any) => toast.error(`Lagring feilet: ${e.message ?? e}`),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) return;
      const { error } = await supabase.functions.invoke("ai-config", {
        body: { action: "delete", id: existing.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konfigurasjon slettet");
      qc.invalidateQueries({ queryKey: ["ai-configs"] });
    },
    onError: (e: any) => toast.error(`Sletting feilet: ${e.message ?? e}`),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Faktura-ekstraksjon</CardTitle>
            <CardDescription>
              {existing ? "Aktiv konfigurasjon" : "Ikke konfigurert — PDF-import bruker tekstmønster (regex)"}
            </CardDescription>
          </div>
          {existing && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {existing.provider} · {existing.model}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Leverandør</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Modell</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODELS[provider].map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label} {m.recommended && <span className="ml-1 text-xs text-primary">★ anbefalt</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>API-key</Label>
            <Input
              type="password"
              placeholder={existing ? "Lim inn for å erstatte (lagret nøkkel skjult)" : "sk-... eller tilsvarende"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Krypteres med AES-256 før lagring. Vises aldri tilbake.
            </p>
          </div>

          {provider === "azure_openai" && (
            <>
              <div>
                <Label>Azure endpoint</Label>
                <Input
                  placeholder="https://din-resource.openai.azure.com"
                  value={azureEndpoint}
                  onChange={(e) => setAzureEndpoint(e.target.value)}
                />
              </div>
              <div>
                <Label>Azure deployment</Label>
                <Input value={azureDeployment} onChange={(e) => setAzureDeployment(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <Label>Max tokens</Label>
            <Input type="number" min={500} max={8000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
          </div>
          <div>
            <Label>Temperature</Label>
            <Input type="number" step="0.05" min={0} max={1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? "default" : "destructive"}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <AlertTitle>{testResult.ok ? "Tilkobling OK" : "Test feilet"}</AlertTitle>
            <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={test} disabled={testing || (!apiKey && !existing)} className="gap-2">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
              {existing && !apiKey ? "Test lagret nøkkel" : "Test API-kall"}
            </Button>
            {existing && (
              <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" /> Slett konfigurasjon
              </Button>
            )}
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !apiKey}>
            {save.isPending ? "Lagrer…" : existing ? "Erstatt konfigurasjon" : "Lagre konfigurasjon"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageSummaryCard({ entries, loading }: { entries: UsageEntry[]; loading: boolean }) {
  const totalCost = entries.reduce((s, e) => s + (Number(e.estimated_cost_usd) || 0), 0);
  const totalCalls = entries.length;
  const failed = entries.filter((e) => !e.success).length;
  const totalIn = entries.reduce((s, e) => s + (e.input_tokens ?? 0), 0);
  const totalOut = entries.reduce((s, e) => s + (e.output_tokens ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bruk siste 30 dager</CardTitle>
        <CardDescription>Estimert kostnad basert på publiserte priser fra leverandørene.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Laster…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Kall" value={totalCalls.toString()} />
            <Stat label="Feilet" value={failed.toString()} />
            <Stat label="Tokens (inn/ut)" value={`${totalIn.toLocaleString()} / ${totalOut.toLocaleString()}`} />
            <Stat label="Estimert kostnad" value={`$${totalCost.toFixed(3)}`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
