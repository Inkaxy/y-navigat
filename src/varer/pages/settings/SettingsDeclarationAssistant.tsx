import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { readFunctionError } from "@/varer/lib/functionError";

/** Absolutt tidspunkt på norsk, f.eks. «tor 3. sep 2026, 14:05». */
function formatOsloDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ukjent";
  return format(d, "EEE d. MMM yyyy, HH:mm", { locale: nb });
}

interface ConfigState {
  key_stored: boolean;
  encryption_ready: boolean;
  usable: boolean;
  provider: string;
  model: string;
  model_valid: boolean;
  daily_cap: number;
  style_notes: string;
  used_today: number;
  quota_date: string;
  key_updated_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean;
  last_test_code: string | null;
  instruction_version: string;
  model_options: string[];
}

class ConfigError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Kjente feilkoder fra endepunktene, på norsk og handlingsrettet. */
function messageForCode(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "not_configured":
      return "Assistenten er ikke satt opp ennå. Lagre en API-nøkkel først.";
    case "encryption_missing":
      return "Serveren mangler krypteringsnøkkelen, så nøkkelen kan verken lagres eller brukes. Kontakt drift.";
    case "quota_exceeded":
      return fallback ?? "Dagens grense er brukt opp. Testen teller på den samme grensen.";
    case "provider_error":
      return fallback ?? "OpenAI svarte ikke som forventet. Nøkkelen er ikke merket som testet.";
    case "bad_key":
      return fallback ?? "Nøkkelen ser ikke gyldig ut. En OpenAI-nøkkel begynner med «sk-».";
    case "bad_cap":
      return fallback ?? "Dagsgrensen må være et helt tall mellom 1 og 500.";
    case "bad_model":
      return fallback ?? "Velg en av de godkjente modellene.";
    case "forbidden":
      return "Bare plattformadministratorer kan endre dette oppsettet.";
    case "read_failed":
      return "Oppsettet kunne ikke leses fra databasen. Ingenting er endret.";
    case "save_failed":
      return fallback ?? "Lagringen feilet. Det forrige oppsettet står urørt.";
    default:
      return fallback ?? "Kallet mot oppsettet feilet.";
  }
}

async function callConfig<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("declaration-assistant-config", { body });
  if (error) {
    const payload = await readFunctionError(error, data);
    throw new ConfigError(messageForCode(payload.code, payload.message), payload.code);
  }
  if (!data || typeof data !== "object") throw new ConfigError("Ugyldig svar fra oppsettet.");
  return data as T;
}

export default function SettingsDeclarationAssistant() {
  const queryClient = useQueryClient();

  const adminQuery = useQuery({
    queryKey: ["platform-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (error) throw error;
      return data === true;
    },
  });
  const isAdmin = adminQuery.data === true;

  const configQuery = useQuery({
    queryKey: ["declaration-assistant-config"],
    enabled: isAdmin,
    queryFn: () => callConfig<ConfigState>({ action: "get" }),
  });

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [dailyCap, setDailyCap] = useState("25");
  const [styleNotes, setStyleNotes] = useState("");

  // Skjemaet fylles fra serveren, men overskriver ikke det brukeren skriver.
  useEffect(() => {
    const c = configQuery.data;
    if (!c) return;
    setModel((prev) => prev || c.model);
    setDailyCap((prev) => (prev === "25" ? String(c.daily_cap) : prev));
    setStyleNotes((prev) => (prev === "" ? c.style_notes : prev));
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      callConfig<{ ok: true }>({
        action: "save",
        api_key: apiKey.trim() || undefined,
        model,
        daily_cap: Number(dailyCap),
        style_notes: styleNotes,
      }),
    onSuccess: () => {
      setApiKey("");
      toast.success("Oppsettet er lagret");
      queryClient.invalidateQueries({ queryKey: ["declaration-assistant-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => callConfig<{ ok: true }>({ action: "disconnect" }),
    onSuccess: () => {
      toast.success("Nøkkelen er koblet fra");
      queryClient.invalidateQueries({ queryKey: ["declaration-assistant-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("declaration-assistant", {
        body: { mode: "selftest" },
      });
      if (error) {
        const payload = await readFunctionError(error, data);
        throw new ConfigError(messageForCode(payload.code, payload.message), payload.code);
      }
      const ok = data as { test_recorded?: boolean; test_stale?: boolean } | null;
      if (ok?.test_stale) {
        throw new ConfigError(
          "Oppsettet ble endret mens testen pågikk. Resultatet er forkastet — kjør testen på nytt.",
        );
      }
      if (ok?.test_recorded === false) {
        throw new ConfigError(
          "Kallet gikk gjennom, men resultatet kunne ikke lagres. Statusen står derfor som «ikke testet».",
        );
      }
      return data as { suggestion?: { markerText?: string } };
    },
    onSuccess: () => {
      toast.success("Testen gikk gjennom — nøkkelen virker");
      queryClient.invalidateQueries({ queryKey: ["declaration-assistant-config"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["declaration-assistant-config"] });
    },
  });

  const busy = saveMutation.isPending || disconnectMutation.isPending || testMutation.isPending;

  if (adminQuery.isError || adminQuery.isLoading) {
    return (
      <div className="px-page py-6">
        <QueryState
          isLoading={adminQuery.isLoading}
          isError={adminQuery.isError}
          error={adminQuery.error}
          scope="varer:deklarasjonsassistent-tilgang"
          onRetry={() => adminQuery.refetch()}
          skeletonRows={3}
        />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="px-page py-6">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>
            Bare en plattformadministrator kan endre oppsettet for deklarasjonsassistenten.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const c = configQuery.data;

  return (
    <div className="space-y-6 px-page py-6">
      <div>
        <h1 className="text-title">Deklarasjonsassistent</h1>
        <p className="text-caption text-muted-foreground">
          Egen OpenAI-nøkkel for språkhjelp på ingredienslister. Nøkkelen deles ikke med fakturatolkningen,
          og assistenten kan verken lagre, godkjenne eller endre tall i en deklarasjon.
        </p>
      </div>

      <QueryState
        isLoading={configQuery.isLoading}
        isError={configQuery.isError}
        error={configQuery.error}
        scope="varer:deklarasjonsassistent-oppsett"
        onRetry={() => configQuery.refetch()}
        skeletonRows={5}
      >
        {c && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  Status
                  {c.key_stored ? (
                    <Badge variant="outline">Nøkkel lagret</Badge>
                  ) : (
                    <Badge variant="secondary">Ingen nøkkel lagret</Badge>
                  )}
                  {c.key_stored &&
                    (c.last_test_ok ? (
                      <Badge variant="outline">Test bestått</Badge>
                    ) : (
                      <Badge variant="secondary">Ikke testet</Badge>
                    ))}
                </CardTitle>
                <CardDescription>
                  At en nøkkel er lagret betyr ikke at den virker. Kjør «Test tilkobling» for å bekrefte det.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-caption text-muted-foreground">
                <p>
                  Brukt i dag ({c.quota_date || "i dag"}): {c.used_today} av {c.daily_cap} kontroller.
                </p>
                {c.key_updated_at && <p>Nøkkel sist oppdatert: {formatOsloDateTime(c.key_updated_at)}</p>}
                {c.last_test_at && (
                  <p>
                    Siste test: {formatOsloDateTime(c.last_test_at)} —{" "}
                    {c.last_test_ok ? "gikk gjennom" : `feilet (${c.last_test_code ?? "ukjent"})`}
                  </p>
                )}
                <p>Instruksjonsversjon: {c.instruction_version}</p>
                {!c.encryption_ready && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Serveren mangler krypteringsnøkkelen AI_CONFIG_ENCRYPTION_KEY. Nøkkelen kan ikke lagres
                      trygt før den er lagt inn.
                    </AlertDescription>
                  </Alert>
                )}
                {c.key_stored && !c.model_valid && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>Lagret modell er ikke lenger godkjent. Velg en modell og lagre på nytt.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nøkkel og grenser</CardTitle>
                <CardDescription>
                  Nøkkelen lagres kryptert og vises aldri igjen. La feltet stå tomt for å beholde den du har.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="api-key">OpenAI API-nøkkel</Label>
                  <Input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    placeholder={c.key_stored ? "Nøkkel er lagret — skriv en ny for å bytte" : "sk-..."}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="model">Modell</Label>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger id="model">
                        <SelectValue placeholder="Velg modell" />
                      </SelectTrigger>
                      <SelectContent>
                        {c.model_options.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cap">Maks kontroller per dag</Label>
                    <Input
                      id="cap"
                      inputMode="numeric"
                      value={dailyCap}
                      onChange={(e) => setDailyCap(e.target.value.replace(/[^\d]/g, ""))}
                    />
                    <p className="text-caption text-muted-foreground">Mellom 1 og 500.</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="style">Husregler for språk</Label>
                  <Textarea
                    id="style"
                    rows={3}
                    value={styleNotes}
                    onChange={(e) => setStyleNotes(e.target.value)}
                    placeholder="F.eks. «skriv hvetemel i ett ord, ikke hvete mel»"
                  />
                  <p className="text-caption text-muted-foreground">
                    Gjelder bare skrivemåte. Ingrediensrekkefølge, tall, prosent og E-numre kan aldri endres.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveMutation.mutate()} disabled={busy || !model}>
                    {saveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Lagre
                  </Button>
                  {c.key_stored && (
                    <Button variant="outline" onClick={() => disconnectMutation.mutate()} disabled={busy}>
                      {disconnectMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      Koble fra nøkkelen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Test tilkobling</CardTitle>
                <CardDescription>
                  Sender én liten, oppdiktet ingrediensliste til OpenAI med samme oppsett som vanlige
                  kontroller. Ingen data om varer, oppskrifter eller kunder sendes. Dette er et ekte,
                  betalt kall på din egen nøkkel, og det teller på dagens grense.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={busy || !c.key_stored || !c.encryption_ready}
                >
                  {testMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Test tilkobling
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}
