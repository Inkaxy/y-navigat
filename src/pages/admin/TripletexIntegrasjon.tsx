import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, KeyRound, CheckCircle2, AlertTriangle, Settings2 } from "lucide-react";

// TODO: Add test connection RPC + button in later prompt.
// NOTE: Tripletex bruker dedikerte tabeller (tripletex_credentials + tripletex_sync_log).
// Unifisering med generic `integrations`-modellen tas i en senere prompt.

export default function TripletexIntegrasjon() {
  const { data: creds = [], isLoading } = useQuery({
    queryKey: ["admin-tripletex-detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tripletex_credentials")
        .select(`
          legal_entity_id, mode, sync_enabled, sync_frequency_minutes,
          last_synced_at, last_sync_status, last_sync_error,
          legal_entities(legal_name, short_code)
        `);
      if (error) throw error;
      const rows = data ?? [];
      // Token-flagg hentes via SECURITY DEFINER funksjon (REVOKED kolonner).
      const enriched = await Promise.all(
        rows.map(async (r: any) => {
          const { data: status } = await (supabase.rpc as any)("tripletex_token_status", {
            _legal_entity_id: r.legal_entity_id,
          });
          const s = Array.isArray(status) ? status[0] : status;
          return {
            ...r,
            has_consumer_token: !!s?.has_consumer_token,
            has_employee_token: !!s?.has_employee_token,
          };
        }),
      );
      return enriched;
    },
  });

  const { data: log = [] } = useQuery({
    queryKey: ["admin-tripletex-sync-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tripletex_sync_log")
        .select("*, legal_entities(legal_name)")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AdminLayout title="Tripletex">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-app" />
          <h1 className="text-2xl font-semibold">Tripletex</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/integrasjoner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Til integrasjoner
          </Link>
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Laster…</p>}
      {!isLoading && creds.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Ingen Tripletex-kobling konfigurert. Konfigureres under Råvarer →
            Innstillinger → Tripletex per selskap.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {creds.map((c: any) => (
          <Card key={c.legal_entity_id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {c.legal_entities?.legal_name ?? c.legal_entity_id}
                </CardTitle>
                {c.last_sync_status === "error" ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> Feil
                  </Badge>
                ) : c.sync_enabled ? (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Aktiv
                  </Badge>
                ) : (
                  <Badge variant="outline">Pause</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <KV label="Modus" value={c.mode} />
                <KV label="Frekvens" value={`${c.sync_frequency_minutes} min`} />
                <KV label="Sist synket" value={c.last_synced_at ? new Date(c.last_synced_at).toLocaleString("nb-NO") : "—"} />
                <KV label="Status" value={c.last_sync_status ?? "—"} />
              </div>

              {c.last_sync_error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {c.last_sync_error}
                </div>
              )}

              <div className="space-y-2">
                <SecretRow label="Consumer token" present={!!c.consumer_token_encrypted} />
                <SecretRow label="Employee token" present={!!c.employee_token_encrypted} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {log.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Siste sync-kjøringer</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-line text-sm">
              {log.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{l.legal_entities?.legal_name ?? l.legal_entity_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(l.started_at).toLocaleString("nb-NO")}
                    </div>
                  </div>
                  <Badge variant={l.status === "error" ? "destructive" : l.status === "success" ? "default" : "secondary"}>
                    {l.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </AdminLayout>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function SecretRow({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line bg-surface-canvas p-3">
      <div className="flex items-center gap-2 text-sm">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">
          {present ? "••••••••" : "ikke satt"}
        </span>
      </div>
      <Button size="sm" variant="outline" disabled>Endre</Button>
    </div>
  );
}
