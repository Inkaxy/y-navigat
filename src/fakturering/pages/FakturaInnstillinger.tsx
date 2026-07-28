import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";
import {
  useFullInvoiceSettings,
  useTripletexTokenStatus,
  useHasFakturaWriteAccess,
  saveInvoiceSettings,
  clearTripletexMetaCache,
} from "@/fakturering/hooks/useFakturering";
import { useTripletexCredentials } from "@/ravarer/hooks/useTripletex";
import { KNOWN_GROUPS } from "@/fakturering/lib/groups";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, Save, Trash2 } from "lucide-react";

const ACCENT = "#a855f7";

export default function FakturaInnstillinger() {
  const { activeEntity, activeEntityId, availableEntities, setActiveEntity, isLoading } = useFaktureringEntity();
  const { data: hasWrite } = useHasFakturaWriteAccess();

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Laster…</div>;
  }
  if (!activeEntityId) {
    return <div className="p-6 text-sm text-muted-foreground">Ingen selskaper tilgjengelig.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
          Innstillinger – Fakturering
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tripletex-tilkobling, forfallsdager, konto-mapping og gruppekonfigurasjon per selskap.
        </p>
      </div>

      {availableEntities.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="text-sm">Selskap:</Label>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={activeEntityId}
            onChange={(e) => setActiveEntity(e.target.value)}
          >
            {availableEntities.map((e) => (
              <option key={e.id} value={e.id}>{e.legal_name}</option>
            ))}
          </select>
        </div>
      )}

      {!hasWrite && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Lesetilgang</AlertTitle>
          <AlertDescription>
            Du har lesetilgang til Fakturering, men mangler admin-tilgang for å endre innstillinger.
          </AlertDescription>
        </Alert>
      )}

      <TripletexSection entityId={activeEntityId} entityName={activeEntity?.legal_name ?? ""} canWrite={!!hasWrite} />
      <SettingsSection entityId={activeEntityId} canWrite={!!hasWrite} />
      <MetaCacheSection entityId={activeEntityId} canWrite={!!hasWrite} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tripletex-tilkobling
// ---------------------------------------------------------------------------
function TripletexSection({ entityId, entityName, canWrite }: { entityId: string; entityName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: status } = useTripletexTokenStatus(entityId);
  const { data: cred } = useTripletexCredentials(entityId);

  const [mode, setMode] = useState<"standard" | "private">("standard");
  const [consumerToken, setConsumerToken] = useState("");
  const [employeeToken, setEmployeeToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (cred?.mode) setMode(cred.mode as any);
    setConsumerToken("");
    setEmployeeToken("");
    setTestResult(null);
  }, [cred, entityId]);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("tripletex-test-connection", {
        body: {
          legal_entity_id: entityId,
          mode,
          consumer_token: consumerToken || undefined,
          employee_token: employeeToken || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.ok) {
        setTestResult({ ok: true, message: `OK – tilkoblet ${(data as any).company?.name ?? "Tripletex"}` });
      } else {
        setTestResult({ ok: false, message: (data as any)?.error ?? "Test feilet" });
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
          legal_entity_id: entityId,
          mode,
          consumer_token: mode === "standard" ? (consumerToken || undefined) : undefined,
          employee_token: employeeToken || undefined,
          sync_enabled: false,
          sync_frequency_minutes: 60,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Tripletex-tokens lagret");
      setConsumerToken(""); setEmployeeToken("");
      qc.invalidateQueries({ queryKey: ["tripletex-credentials", entityId] });
      qc.invalidateQueries({ queryKey: ["fakturering", "tripletex-status", entityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Tripletex-tilkobling</CardTitle>
            <CardDescription>
              Selskap: <span className="font-medium">{entityName}</span>
            </CardDescription>
          </div>
          {status?.connected ? (
            <Badge className="gap-1" style={{ background: ACCENT, color: "white" }}>
              <CheckCircle2 className="h-3 w-3" /> Tilkoblet
            </Badge>
          ) : (
            <Badge variant="outline">Ikke tilkoblet</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            NBHub oppretter kun <strong>utkast</strong> i Tripletex. Godkjenning og fakturering skjer manuelt av Økonomi i Tripletex.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label>Modus</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} disabled={!canWrite}>
            <div className="flex items-start gap-2">
              <RadioGroupItem id={`m-std-${entityId}`} value="standard" />
              <Label htmlFor={`m-std-${entityId}`} className="text-sm">Standard (consumer + employee token)</Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem id={`m-priv-${entityId}`} value="private" />
              <Label htmlFor={`m-priv-${entityId}`} className="text-sm">Privat API (kun employee token)</Label>
            </div>
          </RadioGroup>
        </div>

        {mode === "standard" && (
          <div className="space-y-2">
            <Label>Consumer token</Label>
            <Input
              type="password"
              autoComplete="off"
              disabled={!canWrite}
              placeholder={cred?.has_consumer_token ? "•••••••• (lagret)" : "Lim inn consumer token"}
              value={consumerToken}
              onChange={(e) => setConsumerToken(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Employee token</Label>
          <Input
            type="password"
            autoComplete="off"
            disabled={!canWrite}
            placeholder={cred?.has_employee_token ? "•••••••• (lagret)" : "Lim inn employee token"}
            value={employeeToken}
            onChange={(e) => setEmployeeToken(e.target.value)}
          />
        </div>

        {testResult && (
          <Alert variant={testResult.ok ? "default" : "destructive"}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || !canWrite}>
            {testing ? "Tester…" : "Test tilkobling"}
          </Button>
          <Button onClick={handleSave} disabled={saving || !canWrite} style={{ background: ACCENT, color: "white" }}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Lagrer…" : "Lagre tokens"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fakturering-innstillinger
// ---------------------------------------------------------------------------
function SettingsSection({ entityId, canWrite }: { entityId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useFullInvoiceSettings(entityId);

  const [dueDays, setDueDays] = useState<number>(14);
  const [vat15, setVat15] = useState("3001");
  const [vat25, setVat25] = useState("3000");
  const [vat0, setVat0] = useState("");
  const [nonTransfer, setNonTransfer] = useState<Set<string>>(new Set());
  const [internalGroups, setInternalGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDueDays(settings.default_due_days ?? 14);
    setVat15(String(settings.vat_account_map?.["15"] ?? "3001"));
    setVat25(String(settings.vat_account_map?.["25"] ?? "3000"));
    setVat0(String(settings.vat_account_map?.["0"] ?? ""));
    setNonTransfer(new Set(settings.non_transfer_groups ?? []));
    setInternalGroups(new Set(settings.internal_groups ?? []));
  }, [settings]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const vatMap: Record<string, string> = { "15": vat15.trim(), "25": vat25.trim() };
      if (vat0.trim()) vatMap["0"] = vat0.trim();
      await saveInvoiceSettings({
        legal_entity_id: entityId,
        default_due_days: Math.max(0, Math.min(90, Math.round(dueDays))),
        vat_account_map: vatMap,
        non_transfer_groups: Array.from(nonTransfer),
        internal_groups: Array.from(internalGroups),
      });
      toast.success("Innstillinger lagret");
      qc.invalidateQueries({ queryKey: ["fakturering", "settings-full", entityId] });
      qc.invalidateQueries({ queryKey: ["fakturering", "settings", entityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fakturering</CardTitle>
        <CardDescription>Standardverdier og gruppekonfigurasjon for dette selskapet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Standard forfallsdager</Label>
            <Input
              type="number"
              min={0}
              max={90}
              value={dueDays}
              onChange={(e) => setDueDays(Number(e.target.value))}
              disabled={!canWrite}
            />
            <p className="text-xs text-muted-foreground">
              Brukes når kunden mangler egne betalingsbetingelser (payment_terms_days).
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Kontomapping per mva-sats</Label>
          <p className="text-xs text-muted-foreground">
            Avklar kontoene med regnskapsfører før faktureringen aktiveres.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">25% mva – konto</Label>
              <Input value={vat25} onChange={(e) => setVat25(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label className="text-xs">15% mva – konto</Label>
              <Input value={vat15} onChange={(e) => setVat15(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label className="text-xs">0% mva – konto (valgfri)</Label>
              <Input value={vat0} onChange={(e) => setVat0(e.target.value)} disabled={!canWrite} placeholder="f.eks. 3100" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Overføres ikke til Tripletex</Label>
            <p className="text-xs text-muted-foreground">Grunnlag opprettes, men markeres «Overføres ikke».</p>
            <div className="space-y-1.5">
              {KNOWN_GROUPS.map((g) => (
                <label key={g.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={nonTransfer.has(g.key)}
                    onCheckedChange={() => toggle(nonTransfer, setNonTransfer, g.key)}
                    disabled={!canWrite}
                  />
                  <span>
                    <span className="text-muted-foreground">[{g.code}]</span> {g.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Interne grupper</Label>
            <p className="text-xs text-muted-foreground">Merkes som interne i UI og rapporter.</p>
            <div className="space-y-1.5">
              {KNOWN_GROUPS.map((g) => (
                <label key={g.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={internalGroups.has(g.key)}
                    onCheckedChange={() => toggle(internalGroups, setInternalGroups, g.key)}
                    disabled={!canWrite}
                  />
                  <span>
                    <span className="text-muted-foreground">[{g.code}]</span> {g.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !canWrite} style={{ background: ACCENT, color: "white" }}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Lagrer…" : "Lagre innstillinger"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tripletex-metacache (read-only + tøm)
// ---------------------------------------------------------------------------
function MetaCacheSection({ entityId, canWrite }: { entityId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useFullInvoiceSettings(entityId);
  const [clearing, setClearing] = useState(false);

  const meta = settings?.tripletex_meta ?? {};
  const vatTypes = (meta as any)?.vatTypes ?? (meta as any)?.vat_type_map ?? {};
  const productIds = (meta as any)?.products ?? (meta as any)?.product_ids ?? {};

  const vatEntries = useMemo(() => Object.entries(vatTypes), [vatTypes]);
  const productEntries = useMemo(() => Object.entries(productIds), [productIds]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearTripletexMetaCache(entityId);
      toast.success("Cache tømt");
      qc.invalidateQueries({ queryKey: ["fakturering", "settings-full", entityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke tømme cache");
    } finally {
      setClearing(false);
    }
  };

  const isEmpty = vatEntries.length === 0 && productEntries.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Tripletex-cache</CardTitle>
            <CardDescription>vatType-mapping og samlevare-id-er som er slått opp fra Tripletex.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={clearing || !canWrite || isEmpty}
          >
            {clearing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Tøm cache
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isEmpty && <p className="text-muted-foreground">Cachen er tom – slås opp ved neste overføring.</p>}

        {vatEntries.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">vatType-mapping</div>
            <div className="rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-1">Sats</th>
                    <th className="text-left px-2 py-1">Tripletex vatType-id</th>
                  </tr>
                </thead>
                <tbody>
                  {vatEntries.map(([rate, id]) => (
                    <tr key={rate} className="border-t">
                      <td className="px-2 py-1">{rate}%</td>
                      <td className="px-2 py-1 font-mono">{String(id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {productEntries.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">Samlevare-id-er</div>
            <div className="rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-1">Nøkkel</th>
                    <th className="text-left px-2 py-1">Tripletex product-id</th>
                  </tr>
                </thead>
                <tbody>
                  {productEntries.map(([k, id]) => (
                    <tr key={k} className="border-t">
                      <td className="px-2 py-1">{k}</td>
                      <td className="px-2 py-1 font-mono">{String(id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
