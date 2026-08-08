import { useMemo, useState, useEffect } from "react";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useTripletexCredentials, useTripletexSyncLog } from "@/ravarer/hooks/useTripletex";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Henter feilmeldingen fra edge-funksjonens svar ordrett (f.eks. manglende krypteringsnøkkel). */
async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const res = (error as { context?: Response })?.context;
  if (res && typeof res.text === "function") {
    try {
      const body = await res.clone().text();
      const parsed = JSON.parse(body);
      if (parsed?.error) return String(parsed.error);
      if (body.trim()) return body.slice(0, 500);
    } catch {
      /* ignore parse issues, fall through */
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export default function TripletexSettings() {
  const { data: entities = [], isLoading: entitiesLoading } = useFakturaerLegalEntities();
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEntity && entities[0]) setSelectedEntity(entities[0].id);
  }, [entities, selectedEntity]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
          Tripletex-integrasjon
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Konfigurer automatisk import av betalte fakturaer fra Tripletex.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Tripletex-integrasjon (valgfri)</AlertTitle>
        <AlertDescription className="space-y-2 text-sm mt-2">
          <p>
            Med Tripletex-tilkobling importeres fakturaer automatisk etter at de er godkjent og betalt i Tripletex. Du trenger:
          </p>
          <div className="pl-2">
            <p className="font-medium">API-nøkkel (anbefalt):</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>Én API-nøkkel per selskap, laget i Tripletex under Selskap → API-tokens.</li>
              <li>Nøkkelen vises bare én gang i Tripletex — kopier den med en gang.</li>
            </ul>
          </div>
          <div className="pl-2">
            <p className="font-medium">Eldre alternativer:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>Standard: consumer token fra Tripletex utviklerportal + employee token per selskap.</li>
              <li>Privat API-bruk: kun employee token. Krever direkte API-tilgang på kontoen.</li>
            </ul>
          </div>
          <p className="text-muted-foreground">
            Mens du venter på Tripletex-godkjenning kan du importere fakturaer manuelt under "Importer manuelt".
          </p>
        </AlertDescription>
      </Alert>

      {entitiesLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Laster selskaper…</CardContent></Card>
      ) : entities.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Du har ikke admin-tilgang til noen selskaper.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Selskap</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedEntity ?? undefined} onValueChange={setSelectedEntity}>
                <SelectTrigger><SelectValue placeholder="Velg selskap" /></SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedEntity && <EntityConfig legalEntityId={selectedEntity} />}
        </>
      )}
    </div>
  );
}

function EntityConfig({ legalEntityId }: { legalEntityId: string }) {
  const qc = useQueryClient();
  const { data: cred, isLoading } = useTripletexCredentials(legalEntityId);
  const { data: log = [] } = useTripletexSyncLog(legalEntityId);

  type TripletexMode = "jwt" | "standard" | "private";
  const [mode, setMode] = useState<TripletexMode>("jwt");
  const [jwtToken, setJwtToken] = useState("");
  const [consumerToken, setConsumerToken] = useState("");
  const [employeeToken, setEmployeeToken] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [frequency, setFrequency] = useState(60);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (cred) {
      setMode(cred.mode);
      setSyncEnabled(cred.sync_enabled);
      setFrequency(cred.sync_frequency_minutes);
    } else {
      setMode("jwt");
      setSyncEnabled(false);
      setFrequency(60);
    }
    setJwtToken("");
    setConsumerToken("");
    setEmployeeToken("");
    setTestResult(null);
  }, [cred, legalEntityId]);

  // Ved jwt-modus finnes ikke et eget token-flagg i status-RPC-en; en lagret rad
  // med mode='jwt' betyr at nøkkelen ligger kryptert i basen.
  const hasStoredJwt = cred?.mode === "jwt";
  const isConfigured = mode === "jwt" ? hasStoredJwt : !!cred?.has_employee_token;

  const buildTokenPayload = () => ({
    legal_entity_id: legalEntityId,
    mode,
    jwt_token: mode === "jwt" ? (jwtToken || undefined) : undefined,
    consumer_token: mode === "standard" ? (consumerToken || undefined) : undefined,
    employee_token: mode === "jwt" ? undefined : (employeeToken || undefined),
  });

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-test-connection", {
        body: buildTokenPayload(),
      });
      if (error) throw new Error(await edgeErrorMessage(error, "Test feilet"));
      if (data?.ok) {
        setTestResult({ ok: true, message: `OK – tilkoblet ${data.company?.name ?? "Tripletex"}` });
      } else {
        setTestResult({ ok: false, message: data?.error ?? "Test feilet" });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-save-credentials", {
        body: {
          ...buildTokenPayload(),
          sync_enabled: syncEnabled,
          sync_frequency_minutes: frequency,
        },
      });
      if (error) throw new Error(await edgeErrorMessage(error, "Lagring feilet"));
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Tripletex-konfigurasjon lagret");
      setJwtToken(""); setConsumerToken(""); setEmployeeToken("");
      qc.invalidateQueries({ queryKey: ["tripletex-credentials", legalEntityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-sync-invoices", {
        body: { legal_entity_id: legalEntityId },
      });
      if (error) throw error;
      if ((data as any)?.skipped) toast.info("Tripletex ikke konfigurert");
      else toast.success(`Sync kjørt – hentet ${(data as any)?.fetched ?? 0} bilag`);
      qc.invalidateQueries({ queryKey: ["tripletex-sync-log", legalEntityId] });
      qc.invalidateQueries({ queryKey: ["tripletex-credentials", legalEntityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync feilet");
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Laster…</CardContent></Card>;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Konfigurasjon</CardTitle>
            {isConfigured ? (
              <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Konfigurert</Badge>
            ) : (
              <Badge variant="outline">Ikke konfigurert</Badge>
            )}
          </div>
          <CardDescription>
            {isConfigured
              ? "Tokens er lagret kryptert. La feltene stå tomme for å beholde dem, eller skriv inn nye for å erstatte."
              : "Lim inn API-tokens fra Tripletex."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Modus</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "standard" | "private")}>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="mode-std" value="standard" />
                <div>
                  <Label htmlFor="mode-std" className="font-medium">Standard (consumer + employee token)</Label>
                  <p className="text-xs text-muted-foreground">Brukes når NBhub er registrert som softwareleverandør.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="mode-priv" value="private" />
                <div>
                  <Label htmlFor="mode-priv" className="font-medium">Privat API-bruk (kun employee token)</Label>
                  <p className="text-xs text-muted-foreground">Krever at Tripletex-kontoen har direkte API-tilgang.</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <Label htmlFor="consumer">Consumer token</Label>
              <Input id="consumer" type="password" autoComplete="off"
                placeholder={cred?.has_consumer_token ? "•••••••• (lagret – la stå for å beholde)" : "Lim inn consumer token"}
                value={consumerToken} onChange={(e) => setConsumerToken(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="employee">Employee token</Label>
            <Input id="employee" type="password" autoComplete="off"
              placeholder={cred?.has_employee_token ? "•••••••• (lagret – la stå for å beholde)" : "Lim inn employee token"}
              value={employeeToken} onChange={(e) => setEmployeeToken(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="font-medium">Aktiver automatisk synkronisering</Label>
              <p className="text-xs text-muted-foreground">Henter nye fakturaer i bakgrunnen.</p>
            </div>
            <Switch checked={syncEnabled} onCheckedChange={setSyncEnabled} />
          </div>

          <div className="space-y-2">
            <Label>Sync-frekvens</Label>
            <Select value={String(frequency)} onValueChange={(v) => setFrequency(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Hvert 15. minutt</SelectItem>
                <SelectItem value="60">Hver time</SelectItem>
                <SelectItem value="240">Hver 4. time</SelectItem>
                <SelectItem value="1440">Daglig</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {testResult && (
            <Alert variant={testResult.ok ? "default" : "destructive"}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? "Tester…" : "Test tilkobling"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Lagrer…" : "Lagre"}
            </Button>
            {isConfigured && (
              <Button variant="outline" onClick={handleSyncNow} disabled={syncing} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Synker…" : "Synk nå"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync-historikk</CardTitle>
        </CardHeader>
        <CardContent>
          {!isConfigured ? (
            <p className="text-sm text-muted-foreground">Ingen Tripletex-tilkobling konfigurert. Konfigurer for å aktivere automatisk import.</p>
          ) : log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen sync-kjøringer ennå.</p>
          ) : (
            <ul className="divide-y">
              {log.map((row: any) => (
                <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{new Date(row.started_at).toLocaleString("nb-NO")}</div>
                    {row.error_message && <div className="text-xs text-destructive">{row.error_message}</div>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>hentet: {row.vouchers_fetched}</span>
                    <span>importert: {row.vouchers_imported}</span>
                    <Badge variant={row.status === "success" ? "secondary" : row.status === "error" ? "destructive" : "outline"}>
                      {row.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
