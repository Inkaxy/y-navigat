import { labelFor, SYNC_STATUS_LABELS } from "@/ravarer/lib/labels";
import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { SettingsSaveBar } from "./SettingsSaveBar";
import {
  baselineOf, isTripletexSaved, sameNonSecret, tripletexSaveBlock, tripletexSavePayload,
  type TripletexMode, type TripletexNonSecret, type TripletexTokens,
} from "@/ravarer/lib/tripletexSettings";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useTripletexCredentials, useTripletexSyncLog } from "@/ravarer/hooks/useTripletex";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { isObj } from "@/fakturaer/lib/parseRpcJson";
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
  const embedded = useIsEmbedded();
  const { data: allEntities = [], isLoading: entitiesLoading } = useFakturaerLegalEntities();
  // Kun aktive selskaper — hindrer at API-nøkler lagres på inaktive placeholder-selskaper.
  const entities = useMemo(() => allEntities.filter((e) => e.status !== "inactive"), [allEntities]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  // Kladden for ett selskap flyttes aldri til et annet: bytte krever bekreftelse ved ulagret, og er sperret under lagring.
  const [child, setChild] = useState({ dirty: false, saving: false });
  const onChildState = useCallback((dirty: boolean, saving: boolean) => setChild((c) => (c.dirty === dirty && c.saving === saving ? c : { dirty, saving })), []);
  const guard = useUnsavedChangesGuard(child.dirty || child.saving);
  const pickEntity = (id: string) => { if (id !== selectedEntity) guard.requestAction(() => { setChild({ dirty: false, saving: false }); setSelectedEntity(id); }); };

  useEffect(() => {
    if (!selectedEntity && entities[0]) setSelectedEntity(entities[0].id);
  }, [entities, selectedEntity]);

  return (
    <div className={cn("space-y-6", !embedded && "mx-auto max-w-4xl p-6")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {!embedded && (
            <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
              Tripletex-integrasjon
            </h1>
          )}
          <p className={embedded ? "text-caption text-muted-foreground" : "text-sm text-muted-foreground mt-1"}>
            Konfigurer automatisk import av betalte fakturaer fra Tripletex.
          </p>
        </div>
        {!entitiesLoading && entities.length > 0 && (
          <div className="w-full sm:w-72">
            <label className="text-xs font-medium text-muted-foreground">Selskap</label>
            <Select value={selectedEntity ?? undefined} onValueChange={pickEntity} disabled={child.saving}>
              <SelectTrigger className="mt-1 min-h-[44px] md:min-h-10" aria-label="Selskap"><SelectValue placeholder="Velg selskap" /></SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
        selectedEntity && <EntityConfig key={selectedEntity} legalEntityId={selectedEntity} onState={onChildState} />
      )}
      <UnsavedChangesDialog {...guard.dialogProps} />

    </div>
  );
}

interface SyncInvoiceResult {
  skipped?: boolean | number;
  skipped_count?: number;
  fetched?: number;
  imported?: number;
  failed?: number;
  ufullstendig_henting?: boolean;
  errors?: { invoice_number: string; reason: string }[];
}

function EntityConfig({ legalEntityId, onState }: { legalEntityId: string; onState: (dirty: boolean, saving: boolean) => void }) {
  const qc = useQueryClient();
  const { canWrite, accessLevel } = useRavarer();
  const credQ = useTripletexCredentials(legalEntityId);
  const { data: cred, isLoading } = credQ;
  const { data: log = [] } = useTripletexSyncLog(legalEntityId);

  // Ikke-hemmelige felt: null = følg lagret verdi. Hemmeligheter er egne felt som aldri forhåndsutfylles.
  const [draft, setDraft] = useState<{ rev: number; value: TripletexNonSecret } | null>(null);
  const [tokens, setTokens] = useState<TripletexTokens>({ jwt: "", consumer: "", employee: "" });
  const [supplierSyncing, setSupplierSyncing] = useState(false);
  const [lastRun, setLastRun] = useState<SyncInvoiceResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<{ kind: "saved" | "unknown" | "rejected"; message: string } | null>(null);
  const busy = useRef(false);
  const live = useRef({ mounted: true, canEdit: false });
  const canEdit = canWrite && accessLevel === "admin";
  live.current.canEdit = canEdit;
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);

  const loaded = credQ.isSuccess;
  const baseline = baselineOf(cred ?? null);
  const form = draft?.value ?? baseline;
  const { mode, syncEnabled, frequency } = form;
  const tokensEntered = !!(tokens.jwt.trim() || tokens.consumer.trim() || tokens.employee.trim());
  const dirty = (!!draft && !sameNonSecret(draft.value, baseline)) || tokensEntered;
  useEffect(() => { onState(dirty, saving); }, [dirty, saving, onState]);
  useEffect(() => () => onState(false, false), [onState]);

  const setForm = (p: Partial<TripletexNonSecret>) => {
    if (busy.current) return;
    setSaveOutcome(null);
    setDraft((cur) => ({ rev: (cur?.rev ?? 0) + 1, value: { ...(cur?.value ?? baseline), ...p } }));
  };
  const setMode = (m: TripletexMode) => setForm({ mode: m });
  const setSyncEnabled = (v: boolean) => setForm({ syncEnabled: v });
  const setFrequency = (v: number) => setForm({ frequency: v });
  const setToken = (k: keyof TripletexTokens, v: string) => { setSaveOutcome(null); setTokens((t) => ({ ...t, [k]: v })); };
  const jwtToken = tokens.jwt, consumerToken = tokens.consumer, employeeToken = tokens.employee;
  const setJwtToken = (v: string) => setToken("jwt", v);
  const setConsumerToken = (v: string) => setToken("consumer", v);
  const setEmployeeToken = (v: string) => setToken("employee", v);

  // Ved jwt-modus finnes ikke et eget token-flagg i status-RPC-en; en lagret rad
  // med mode='jwt' betyr at nøkkelen ligger kryptert i basen.
  const hasStoredJwt = cred?.mode === "jwt";
  const isConfigured = mode === "jwt" ? hasStoredJwt : !!cred?.has_employee_token;
  const block = loaded ? tripletexSaveBlock(cred ?? null, form, tokens) : "Konfigurasjonen er ikke lest.";
  const blankTest = mode === "jwt" ? !tokens.jwt.trim() : !tokens.employee.trim();

  const buildTokenPayload = () => ({
    legal_entity_id: legalEntityId,
    mode,
    jwt_token: mode === "jwt" ? (jwtToken.trim() || undefined) : undefined,
    consumer_token: mode === "standard" ? (consumerToken.trim() || undefined) : undefined,
    employee_token: mode === "jwt" ? undefined : (employeeToken.trim() || undefined),
  });

  /** Eksplisitt test — lagrer ingenting. Uten ny nøkkel testes LAGRET konfigurasjon (lagret modus). */
  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-test-connection", {
        body: buildTokenPayload(),
      });
      if (!live.current.mounted) return;
      if (error) throw new Error(await edgeErrorMessage(error, "Test feilet"));
      if (isObj(data) && data.ok === true) {
        const company = isObj(data.company) ? data.company : null;
        const navn = company && typeof company.name === "string" ? company.name : "Tripletex";
        const orgnr = company && typeof company.organization_number === "string" ? company.organization_number : null;
        setTestResult({
          ok: true,
          message: `OK – tilkoblet ${navn}${orgnr ? ` (org.nr ${orgnr})` : ""}${blankTest ? " · testet lagret konfigurasjon" : ""}`,
        });
      } else {
        setTestResult({ ok: false, message: isObj(data) && typeof data.error === "string" ? data.error : "Test feilet" });
      }
    } catch (e) {
      if (live.current.mounted) setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current.mounted) setTesting(false);
    }
  };

  const handleSave = async () => {
    if (busy.current || block || !dirty || !canEdit) return;
    busy.current = true;
    setSaving(true);
    setSaveOutcome(null);
    // Frosset innhold: selskap, ikke-hemmelige felt (med revisjon) og de innsendte nøklene.
    const frozen = { rev: draft?.rev ?? 0, form, tokens: { ...tokens } };
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-save-credentials", {
        body: tripletexSavePayload(legalEntityId, frozen.form, frozen.tokens),
      });
      if (!live.current.mounted) return;
      if (error) {
        const msg = await edgeErrorMessage(error, "Lagring feilet");
        const status = (error as { context?: Response })?.context?.status;
        // 4xx = avvist (ingenting lagret). Ellers kan utfallet være ukjent.
        if (status != null && status >= 400 && status < 500) setSaveOutcome({ kind: "rejected", message: msg });
        else setSaveOutcome({ kind: "unknown", message: "Utfallet er ukjent. Konfigurasjonen er lest på nytt — kontroller den før du lagrer igjen." });
      } else if (!isTripletexSaved(data)) {
        setSaveOutcome({ kind: "unknown", message: "Uventet svar: lagringen er ikke bekreftet. Konfigurasjonen er lest på nytt — kontroller den før du lagrer igjen." });
      } else {
        // Bare innsendte verdier kvitteres: en nøkkel skrevet inn etter trykk på Lagre beholdes.
        setTokens((t) => ({
          jwt: t.jwt === frozen.tokens.jwt ? "" : t.jwt,
          consumer: t.consumer === frozen.tokens.consumer ? "" : t.consumer,
          employee: t.employee === frozen.tokens.employee ? "" : t.employee,
        }));
        setDraft((cur) => (cur && cur.rev === frozen.rev ? null : cur));
        setSaveOutcome({ kind: "saved", message: "Konfigurasjonen er lagret. Tilkoblingen er ikke testet — bruk «Test tilkobling»." });
      }
    } catch (e) {
      console.warn("[tripletex] lagring: ukjent utfall", e instanceof Error ? e.name : "ukjent");
      if (live.current.mounted) setSaveOutcome({ kind: "unknown", message: "Utfallet er ukjent. Kontroller konfigurasjonen før du lagrer igjen." });
    } finally {
      busy.current = false;
      void qc.invalidateQueries({ queryKey: ["tripletex-credentials", legalEntityId] });
      if (live.current.mounted) setSaving(false);
    }
  };

  const cancel = () => { if (busy.current) return; setDraft(null); setTokens({ jwt: "", consumer: "", employee: "" }); setSaveOutcome(null); };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-sync-invoices", {
        body: { legal_entity_id: legalEntityId },
      });
      if (error) throw error;
      const res = data as SyncInvoiceResult | null;
      setLastRun(res ?? null);
      if (res?.skipped === true) toast.info("Tripletex ikke konfigurert");
      else
        toast.success(
          `Sync kjørt – hentet ${res?.fetched ?? 0}, importert ${res?.imported ?? 0}, hoppet over ${res?.skipped_count ?? res?.skipped ?? 0}, feilet ${res?.failed ?? 0}`,
        );
      qc.invalidateQueries({ queryKey: ["tripletex-sync-log", legalEntityId] });
      qc.invalidateQueries({ queryKey: ["tripletex-credentials", legalEntityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync feilet");
    } finally {
      setSyncing(false);
    }
  };

  const handleSupplierSync = async () => {
    setSupplierSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-sync-suppliers", {
        body: { legal_entity_id: legalEntityId },
      });
      if (error) throw error;
      const res = data as { hentet?: number; opprettet?: number; oppdatert?: number; hoppet?: number } | null;
      toast.success(
        `Leverandører: ${res?.hentet ?? 0} hentet, ${res?.opprettet ?? 0} nye, ${res?.oppdatert ?? 0} oppdatert${res?.hoppet ? `, ${res.hoppet} hoppet over` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["tripletex-credentials", legalEntityId] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Leverandørsynk feilet");
    } finally {
      setSupplierSyncing(false);
    }
  };

  if (isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Laster…</CardContent></Card>;
  if (credQ.isError) {
    return (
      <Card><CardContent className="space-y-2 p-6 text-sm">
        <p className="text-destructive">Kunne ikke lese Tripletex-konfigurasjonen. Ingenting kan lagres før den er lest.</p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => void credQ.refetch()}>Prøv igjen</Button>
      </CardContent></Card>
    );
  }
  const inputsDisabled = saving || !canEdit;

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
              ? "Nøkler er lagret kryptert og vises aldri. La feltene stå tomme for å beholde dem i samme modus, eller skriv inn nye for å erstatte."
              : "Lim inn nøkkel fra Tripletex."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Modus</Label>
            <RadioGroup value={mode} disabled={inputsDisabled} onValueChange={(v) => { if (v === "jwt" || v === "standard" || v === "private") setMode(v); }}>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="mode-jwt" value="jwt" />
                <div>
                  <Label htmlFor="mode-jwt" className="font-medium">API-nøkkel (anbefalt)</Label>
                  <p className="text-xs text-muted-foreground">Én nøkkel per selskap. Lages i Tripletex under Selskap → API-tokens.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="mode-std" value="standard" />
                <div>
                  <Label htmlFor="mode-std" className="font-medium">Standard (consumer + employee token)</Label>
                  <p className="text-xs text-muted-foreground">Eldre alternativ. Brukes når NBhub er registrert som softwareleverandør.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="mode-priv" value="private" />
                <div>
                  <Label htmlFor="mode-priv" className="font-medium">Privat API-bruk (kun employee token)</Label>
                  <p className="text-xs text-muted-foreground">Eldre alternativ. Krever at Tripletex-kontoen har direkte API-tilgang.</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {mode === "jwt" ? (
            <div className="space-y-2">
              <Label htmlFor="jwt">API-nøkkel</Label>
              <Input id="jwt" type="password" autoComplete="off" disabled={!canEdit}
                placeholder={hasStoredJwt ? "•••••••• (lagret – la stå for å beholde)" : "Lim inn API-nøkkel"}
                value={jwtToken} onChange={(e) => setJwtToken(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Nøkkelen vises bare én gang i Tripletex — kopier den med en gang.
              </p>
            </div>
          ) : (
            <>
              {mode === "standard" && (
                <div className="space-y-2">
                  <Label htmlFor="consumer">Consumer token</Label>
                  <Input id="consumer" type="password" autoComplete="off" disabled={!canEdit}
                    placeholder={cred?.has_consumer_token ? "•••••••• (lagret – la stå for å beholde)" : "Lim inn consumer token"}
                    value={consumerToken} onChange={(e) => setConsumerToken(e.target.value)} />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="employee">Employee token</Label>
                <Input id="employee" type="password" autoComplete="off" disabled={!canEdit}
                  placeholder={cred?.has_employee_token ? "•••••••• (lagret – la stå for å beholde)" : "Lim inn employee token"}
                  value={employeeToken} onChange={(e) => setEmployeeToken(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="font-medium">Aktiver automatisk synkronisering</Label>
              <p className="text-xs text-muted-foreground">Henter nye fakturaer i bakgrunnen.</p>
            </div>
            <Switch checked={syncEnabled} disabled={inputsDisabled} onCheckedChange={setSyncEnabled} aria-label="Aktiver automatisk synkronisering" />
          </div>

          <div className="space-y-2">
            <Label>Sync-frekvens</Label>
            <Select value={String(frequency)} disabled={inputsDisabled} onValueChange={(v) => setFrequency(Number(v))}>
              <SelectTrigger aria-label="Sync-frekvens"><SelectValue /></SelectTrigger>
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

          {saveOutcome && (
            <Alert variant={saveOutcome.kind === "saved" ? "default" : "destructive"}>
              {saveOutcome.kind === "saved" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertDescription>{saveOutcome.message}</AlertDescription>
            </Alert>
          )}
          {dirty && block && <p className="text-sm text-warning" role="note">{block}</p>}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" className="min-h-[44px] md:min-h-10" onClick={handleTest} disabled={testing || !canEdit}>
              {testing ? "Tester…" : blankTest ? "Test lagret tilkobling" : "Test tilkobling"}
            </Button>
            {isConfigured && (
              <>
                <Button variant="outline" onClick={handleSyncNow} disabled={syncing} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Synker fakturaer…" : "Kjør fakturasynk nå"}
                </Button>
                <Button variant="outline" onClick={handleSupplierSync} disabled={supplierSyncing} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${supplierSyncing ? "animate-spin" : ""}`} />
                  {supplierSyncing ? "Synker leverandører…" : "Kjør leverandørsynk nå"}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      {canEdit && (
        <SettingsSaveBar dirty={dirty} saving={saving} canSave={dirty && !block && !saving && loaded} onSave={() => void handleSave()} onCancel={cancel} />
      )}

      {isConfigured && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Synkstatus</CardTitle>
            <CardDescription>Siste kjøring, feil og hvor langt importen har kommet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Siste fakturasynk</p>
                <p>{cred?.last_synced_at ? new Date(cred.last_synced_at).toLocaleString("nb-NO") : "Aldri"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Siste leverandørsynk</p>
                <p>{cred?.last_supplier_sync_at ? new Date(cred.last_supplier_sync_at).toLocaleString("nb-NO") : "Aldri"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Synket til og med</p>
                <p>{cred?.last_invoice_synced_date ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                <p>
                  <Badge
                    variant={
                      cred?.last_sync_status === "success"
                        ? "secondary"
                        : cred?.last_sync_status === "error"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {cred?.last_sync_status ? labelFor(SYNC_STATUS_LABELS, cred.last_sync_status, "Ukjent status").label : "Ikke synkronisert"}
                  </Badge>
                </p>
              </div>
            </div>
            {cred?.last_sync_error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{cred.last_sync_error}</AlertDescription>
              </Alert>
            )}
            {lastRun && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Siste kjøring: {lastRun.fetched ?? 0} hentet, {lastRun.imported ?? 0} importert,{" "}
                  {lastRun.skipped_count ?? lastRun.skipped ?? 0} hoppet over, {lastRun.failed ?? 0} feilet
                  {lastRun.ufullstendig_henting ? " (ufullstendig henting)" : ""}
                </p>
                {lastRun.errors && lastRun.errors.length > 0 && (
                  <ul className="space-y-1 rounded-md border p-2 text-xs">
                    {lastRun.errors.map((e, i) => (
                      <li key={`${e.invoice_number}-${i}`} className="text-destructive">
                        Faktura {e.invoice_number}: {e.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
              {log.map((row) => {
                const note = isObj(row.details) && typeof row.details.note === "string" ? row.details.note : null;
                return (
                  <li key={row.id} className="flex items-start justify-between gap-4 py-2 text-sm">
                    <div>
                      <div className="font-medium">{new Date(row.started_at).toLocaleString("nb-NO")}</div>
                      {row.error_message && <div className="text-xs text-destructive">{row.error_message}</div>}
                      {note && <div className="text-xs text-muted-foreground mt-0.5">{note}</div>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>hentet: {row.vouchers_fetched}</span>
                      <span>importert: {row.vouchers_imported}</span>
                      <Badge variant={row.status === "success" ? "secondary" : row.status === "error" ? "destructive" : "outline"}>
                        {labelFor(SYNC_STATUS_LABELS, row.status, "Ukjent status").label}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
