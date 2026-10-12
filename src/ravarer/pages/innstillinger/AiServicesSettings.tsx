import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { useEffect, useRef, useState } from "react";
import { parseDecimal } from "@/fakturaer/lib/units";
import { QueryState } from "@/components/common/QueryState";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  aiDraftFrom, isAiDeleted, parseAiConfigs, parseAiSaveResult, parseAiUsage, sameAiDraft,
  type AiConfig, type AiDraft, type AiProvider, type UsageEntry,
} from "@/ravarer/lib/aiConfig";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { isObj } from "@/fakturaer/lib/parseRpcJson";
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
import { SettingsSaveBar } from "./SettingsSaveBar";

type Provider = AiProvider;

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
  const embedded = useIsEmbedded();

  const configs = useQuery({
    queryKey: ["ai-configs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "list" } });
      if (error) throw error;
      return parseAiConfigs(data);
    },
  });

  const usage = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "usage_summary" } });
      if (error) throw error;
      return parseAiUsage(data);
    },
  });

  const invoiceConfig = configs.data?.find((c) => c.purpose === "invoice_extraction" && c.is_active);

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-4xl p-6")}>
      <div>
        {!embedded && (
          <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
            AI-tjenester
          </h1>
        )}
        <p className={embedded ? "text-caption text-muted-foreground" : "text-sm text-muted-foreground mt-1"}>
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

      {configs.data ? (
        <ExtractionConfigCard
          existing={invoiceConfig ?? null}
          onSaved={async () => { const r = await configs.refetch(); return r.isSuccess && !r.isError; }}
        />
      ) : (
        <QueryState scope="AI-konfigurasjon" isLoading={configs.isLoading} isError={configs.isError} error={configs.error}
          onRetry={() => void configs.refetch()} isEmpty={false}>{null}</QueryState>
      )}

      {usage.isError ? (
        <QueryState scope="AI-bruk" isLoading={false} isError error={usage.error} onRetry={() => void usage.refetch()} isEmpty={false}>{null}</QueryState>
      ) : (
        <UsageSummaryCard entries={usage.data ?? []} loading={usage.isLoading} />
      )}
    </div>
  );
}

function ExtractionConfigCard({ existing, onSaved }: { existing: AiConfig | null; onSaved: () => Promise<boolean> }) {
  const qc = useQueryClient();
  // Kladd: null = følg lagret konfigurasjon. Lagret modell beholdes selv om den ikke står i listen.
  const [draft, setDraft] = useState<{ rev: number; value: AiDraft } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<{ kind: "saved" | "unknown" | "rejected"; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  /** Ukjent lagringsutfall: lagring forblir sperret til gjeldende konfigurasjon faktisk er lest på nytt. */
  const [recon, setRecon] = useState<null | "reading" | "failed">(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const baseline = aiDraftFrom(existing);
  const d = draft?.value ?? baseline;
  const { provider, model, azureEndpoint, azureDeployment } = d;
  const maxTokens = parseDecimal(d.maxTokens);
  const temperature = parseDecimal(d.temperature);
  const dirty = (!!draft && !sameAiDraft(draft.value, baseline)) || apiKey.trim().length > 0;
  const guard = useUnsavedChangesGuard(dirty);
  const set = (p: Partial<AiDraft>) => {
    if (busy.current) return;
    setSaveOutcome(null);
    setDraft((cur) => ({ rev: (cur?.rev ?? 0) + 1, value: { ...(cur?.value ?? baseline), ...p } }));
  };
  // Eksplisitt leverandørbytte: modell som ikke passer tømmes og må velges (ingen stille erstatning).
  const setProvider = (p: Provider) => set({ provider: p, model: MODELS[p].some((m) => m.value === d.model) || (existing?.provider === p && existing.model === d.model) ? d.model : "" });
  const setModel = (m: string) => set({ model: m });
  const modelOptions = [...MODELS[provider]];
  if (model && !modelOptions.some((m) => m.value === model)) modelOptions.unshift({ value: model, label: `${model} (lagret)` });

  const fieldError =
    !model ? "Velg modell." :
    maxTokens == null || !Number.isInteger(maxTokens) || maxTokens < 1 ? "Max tokens må være et helt tall." :
    temperature == null || temperature < 0 || temperature > 2 ? "Temperature må være mellom 0 og 2." :
    provider === "azure_openai" && (!azureEndpoint.trim() || !azureDeployment.trim()) ? "Azure krever endpoint og deployment." : null;
  // Tjenesten krever alltid ny nøkkel ved lagring — også for ikke-hemmelige endringer (ingen «behold nøkkel»).
  const keyNeeded = !apiKey.trim();
  const saveBlock = fieldError ?? (keyNeeded ? (existing ? "Tjenesten lagrer alltid en ny konfigurasjon og krever at API-nøkkelen limes inn på nytt, også når du bare endrer modell eller grenser." : "Lim inn API-nøkkel.") : null);
  // «Test lagret»: uten ny nøkkel kan bare den uendrede lagrede konfigurasjonen testes.
  const storedTestOnly = keyNeeded;
  const testBlock = storedTestOnly
    ? !existing ? "Lim inn API-nøkkel for å teste." : draft && !sameAiDraft(d, baseline) ? "Ulagrede endringer kan bare testes med en ny API-nøkkel. Uten nøkkel testes lagret konfigurasjon — avbryt endringene først." : null
    : fieldError;

  const test = async () => {
    if (testBlock) return;
    setTesting(true); setTestResult(null);
    const tested = storedTestOnly && existing ? `${existing.provider} · ${existing.model} (lagret)` : `${provider} · ${model}`;
    try {
      const body = storedTestOnly && existing
        ? { provider: existing.provider, model: existing.model, purpose: "invoice_extraction",
            azure_endpoint: existing.provider === "azure_openai" ? existing.azure_endpoint : undefined,
            azure_deployment: existing.provider === "azure_openai" ? existing.azure_deployment : undefined }
        : { provider, api_key: apiKey.trim(), model, purpose: "invoice_extraction",
            azure_endpoint: provider === "azure_openai" ? azureEndpoint : undefined,
            azure_deployment: provider === "azure_openai" ? azureDeployment : undefined };
      const { data, error } = await supabase.functions.invoke("ai-config-test", { body });
      if (!mounted.current) return;
      if (error) {
        let detail = "Testen feilet.";
        if (error instanceof FunctionsHttpError) {
          try {
            const parsed: unknown = await error.context.json();
            if (isObj(parsed) && typeof parsed.error === "string") detail = parsed.error;
          } catch (parseErr) {
            console.error("[ai-config-test] uleselig feilsvar", parseErr instanceof Error ? parseErr.name : "ukjent");
          }
        }
        setTestResult({ ok: false, message: `${tested}: ${detail}` });
        return;
      }
      if (isObj(data) && data.ok === true) {
        setTestResult({ ok: true, message: `${tested}: modellen svarte «${typeof data.sample_response === "string" ? data.sample_response : ""}»` });
      } else {
        setTestResult({ ok: false, message: `${tested}: ${isObj(data) && typeof data.error === "string" ? data.error : "Ukjent feil"}` });
      }
    } catch (e) {
      if (mounted.current) setTestResult({ ok: false, message: `${tested}: ${e instanceof Error ? e.message : "Ukjent feil"}` });
    } finally {
      if (mounted.current) setTesting(false);
    }
  };

  const save = async () => {
    if (busy.current || recon || saveBlock || maxTokens == null || temperature == null) return;
    busy.current = true;
    setSaving(true);
    const frozen = { rev: draft?.rev ?? 0, key: apiKey };
    setSaveOutcome(null);
    let unknown = false;
    try {
      const { data, error } = await supabase.functions.invoke("ai-config", {
        body: {
          action: "save", provider, api_key: frozen.key.trim(), model, max_tokens: maxTokens, temperature,
          purpose: "invoice_extraction",
          azure_endpoint: provider === "azure_openai" ? azureEndpoint : undefined,
          azure_deployment: provider === "azure_openai" ? azureDeployment : undefined,
        },
      });
      const status = error instanceof FunctionsHttpError ? error.context.status : null;
      if (!mounted.current) return;
      if (error && status === 400) {
        setSaveOutcome({ kind: "rejected", message: "Lagringen ble avvist (ugyldige felt eller nøkkel). Ingenting er endret." });
      } else if (error || !parseAiSaveResult(data)) {
        unknown = true;
      } else {
        setApiKey((k) => (k === frozen.key ? "" : k));
        setDraft((cur) => (cur && cur.rev === frozen.rev ? null : cur));
        setSaveOutcome({ kind: "saved", message: "Konfigurasjonen er lagret." });
      }
    } catch (e) {
      console.warn("[ai-config] lagring: ukjent utfall", e instanceof Error ? e.name : "ukjent");
      unknown = true;
    }
    if (unknown) {
      // Lagring skjer i flere steg uten transaksjon: forrige konfigurasjon kan være deaktivert.
      // Sperren holdes til gjeldende konfigurasjon er lest; aldri automatisk nytt forsøk.
      if (mounted.current) setSaving(false);
      await reconcile();
    } else {
      busy.current = false;
      if (mounted.current) setSaving(false);
      await onSaved();
    }
    void qc.invalidateQueries({ queryKey: ["ai-usage"] });
  };

  /** Leser gjeldende konfigurasjon etter ukjent utfall. Frigjør bare ved vellykket lesing. */
  const reconcile = async () => {
    busy.current = true;
    if (mounted.current) {
      setRecon("reading");
      setSaveOutcome({ kind: "unknown", message: "Utfallet av lagringen er ukjent. Leser gjeldende konfigurasjon …" });
    }
    let ok = false;
    try { ok = await onSaved(); } catch (e) { console.warn("[ai-config] avstemming feilet", e instanceof Error ? e.name : "ukjent"); }
    if (!mounted.current) return;
    if (ok) {
      busy.current = false;
      setRecon(null);
      setSaveOutcome({ kind: "unknown", message: "Gjeldende lagret konfigurasjon er lest på nytt, men utfallet av den opprinnelige lagringen er fortsatt ukjent (ingen kvittering). Feltene du har endret er fortsatt en ulagret kladd og kan avvike fra det som er lagret. Trykker du Lagre, sendes en ny, bevisst lagring." });
    } else {
      setRecon("failed");
      setSaveOutcome({ kind: "unknown", message: "Utfallet av lagringen er ukjent, og gjeldende konfigurasjon kunne ikke leses. Lagring er sperret til den er lest." });
    }
  };

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "delete", id } });
      if (error) throw error;
      if (!isAiDeleted(data)) throw new Error("Slettingen er ikke bekreftet.");
    },
    onSuccess: () => { toast.success("Konfigurasjon slettet"); setConfirmDelete(false); },
    onError: () => toast.error("Slettingen er ikke bekreftet. Konfigurasjonen er lest på nytt."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-configs"] }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Faktura-ekstraksjon</CardTitle>
            <CardDescription>
              {existing ? "Aktiv konfigurasjon (felles for alle selskaper)" : "Ikke konfigurert — PDF-import bruker tekstmønster (regex)"}
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
            <Select value={provider} onValueChange={(v) => { if (v === "anthropic" || v === "openai" || v === "azure_openai") setProvider(v); }}>
              <SelectTrigger className="min-h-[44px] md:min-h-10" aria-label="Leverandør"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Modell</Label>
            <Select value={model || undefined} onValueChange={setModel}>
              <SelectTrigger className="min-h-[44px] md:min-h-10" aria-label="Modell"><SelectValue placeholder="Velg modell" /></SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label} {"recommended" in m && m.recommended && <span className="ml-1 text-xs text-primary">★ anbefalt</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ai-key">API-nøkkel</Label>
            <Input
              id="ai-key"
              type="password"
              placeholder={existing ? "Lagret nøkkel vises ikke. Lim inn for å lagre endringer." : "sk-... eller tilsvarende"}
              value={apiKey}
              onChange={(e) => { setSaveOutcome(null); setApiKey(e.target.value); }}
              autoComplete="new-password"
              className="min-h-[44px] md:min-h-10"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Krypteres før lagring og vises aldri tilbake. Lagring krever alltid nøkkel; sletting er en egen handling.
            </p>
          </div>

          {provider === "azure_openai" && (
            <>
              <div>
                <Label htmlFor="ai-az-e">Azure endpoint</Label>
                <Input id="ai-az-e" className="min-h-[44px] md:min-h-10" placeholder="https://din-resource.openai.azure.com" value={azureEndpoint} onChange={(e) => set({ azureEndpoint: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="ai-az-d">Azure deployment</Label>
                <Input id="ai-az-d" className="min-h-[44px] md:min-h-10" value={azureDeployment} onChange={(e) => set({ azureDeployment: e.target.value })} />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="ai-max">Max tokens</Label>
            <Input id="ai-max" className="min-h-[44px] md:min-h-10" inputMode="numeric" value={d.maxTokens} onChange={(e) => set({ maxTokens: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ai-temp">Temperature</Label>
            <Input id="ai-temp" className="min-h-[44px] md:min-h-10" inputMode="decimal" value={d.temperature} onChange={(e) => set({ temperature: e.target.value })} />
          </div>
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? "default" : "destructive"}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <AlertTitle>{testResult.ok ? "Tilkobling OK" : "Test feilet"}</AlertTitle>
            <AlertDescription className="text-xs">{testResult.message}</AlertDescription>
          </Alert>
        )}
        {saveOutcome && (
          <Alert variant={saveOutcome.kind === "saved" ? "default" : "destructive"}>
            <AlertDescription className="text-sm">{saveOutcome.message}</AlertDescription>
          </Alert>
        )}
        {recon && (
          <div className="flex flex-wrap items-center gap-2" data-testid="ai-reconcile">
            <span className="text-sm">{recon === "reading" ? "Leser gjeldende konfigurasjon …" : "Gjeldende konfigurasjon er ikke lest."}</span>
            {recon === "failed" && <Button variant="outline" className="min-h-[44px]" onClick={() => void reconcile()}>Les konfigurasjonen på nytt</Button>}
          </div>
        )}
        {dirty && saveBlock && <p role="note" className="text-sm text-warning">{saveBlock}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="outline" className="min-h-[44px] gap-2 md:min-h-10" onClick={() => void test()} disabled={testing || !!testBlock}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
            {storedTestOnly ? "Test lagret konfigurasjon" : "Test med ny nøkkel"}
          </Button>
          {existing && (
            <Button variant="ghost" className="min-h-[44px] gap-2 text-destructive md:min-h-10" onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>
              <Trash2 className="h-4 w-4" /> Slett konfigurasjon
            </Button>
          )}
          {testBlock && storedTestOnly && existing && dirty && <span className="text-caption text-ink-secondary">{testBlock}</span>}
        </div>
        <SettingsSaveBar dirty={dirty} saving={saving} canSave={dirty && !saveBlock && !saving && !recon}
          onSave={() => void save()} onCancel={() => { if (busy.current || recon) return; setDraft(null); setApiKey(""); setSaveOutcome(null); }}
          saveLabel={existing ? "Erstatt konfigurasjon" : "Lagre konfigurasjon"} />
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette AI-konfigurasjonen?</AlertDialogTitle>
            <AlertDialogDescription>Fakturalesingen faller tilbake på tekstmønster til en ny konfigurasjon er lagret. Gjelder alle selskaper.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => existing && remove.mutate(existing.id)} disabled={remove.isPending}>Slett</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog {...guard.dialogProps} />
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
