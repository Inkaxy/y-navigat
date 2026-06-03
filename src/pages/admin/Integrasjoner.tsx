import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plug, RefreshCw, AlertTriangle, CheckCircle2, Settings2, ArrowRight, Mail, Sparkles,
} from "lucide-react";

// NOTE: Tripletex uses its own dedicated tables (tripletex_credentials +
// tripletex_sync_log) and is rendered as a top card here. Microsoft 365 og
// AI-tjenester har egne kort som leser fra egne tabeller/RPC-er. Det generiske
// `integrations`-griddet under er for fremtidige seedede integrasjoner.

const PLACEHOLDERS = [
  { type: "tedebe", name: "Tedebe", desc: "Råvarer-katalog og databladimport." },
  { type: "fiken",  name: "Fiken",  desc: "Regnskap og fakturering." },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv", error: "Feil", disabled: "Deaktivert", configuring: "Konfigureres",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default", error: "destructive", disabled: "outline", configuring: "secondary",
};

export default function Integrasjoner() {
  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, integration_type, display_name, description, status, last_sync_at, last_error_at, last_error_message, consecutive_errors, legal_entity_id")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tripletex = [] } = useQuery({
    queryKey: ["admin-tripletex-overview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tripletex_credentials")
        .select("legal_entity_id, sync_enabled, last_synced_at, last_sync_status, last_sync_error, mode")
        .order("legal_entity_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: m365 } = useQuery({
    queryKey: ["admin-integrations-m365"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_email_m365_status");
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return row as { connected: boolean; account_email: string | null; connected_at: string | null } | null;
    },
  });

  const { data: aiConfigs = [] } = useQuery({
    queryKey: ["admin-integrations-ai-configs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_provider_config")
        .select("id, provider, model, purpose, is_active")
        .eq("is_active", true);
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: aiCost30d = 0 } = useQuery({
    queryKey: ["admin-integrations-ai-cost-30d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400e3).toISOString();
      const { data, error } = await (supabase as any)
        .from("ai_usage_log")
        .select("estimated_cost_usd")
        .gte("created_at", since)
        .limit(5000);
      if (error) return 0;
      return (data as any[]).reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
    },
  });

  const tConfigured = tripletex.length;
  const tErrors = tripletex.filter((c: any) => c.last_sync_status === "error").length;
  const tLast = tripletex.map((c: any) => c.last_synced_at).filter(Boolean).sort().reverse()[0];

  // Skjul placeholder-kort hvis seedet senere
  const seededTypes = new Set(integrations.map((i: any) => i.integration_type));
  const visiblePlaceholders = PLACEHOLDERS.filter((p) => !seededTypes.has(p.type));

  return (
    <AdminLayout title="Integrasjoner">
      <AppHeaderBanner
        icon={Plug}
        title="Integrasjoner"
        subtitle="Eksterne systemer og API-koblinger på tvers av selskaper."
      />

      {/* Tripletex-kort (egen modell) */}
      <Link to="/admin/integrasjoner/tripletex" className="block">
        <Card className="transition hover:border-app hover:shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app/10 text-app">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Tripletex</h3>
                  {tConfigured === 0 ? (
                    <Badge variant="outline">Ikke konfigurert</Badge>
                  ) : tErrors > 0 ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> Feil på {tErrors}
                    </Badge>
                  ) : (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {tConfigured} aktive
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Regnskap og fakturaimport per selskap.{" "}
                  {tLast && <>Sist synket {new Date(tLast).toLocaleString("nb-NO")}.</>}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      {/* M365 + AI plattform-kort */}
      <Link to="/admin/integrasjoner/email-m365" className="block">
        <Card className="transition hover:border-app hover:shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app/10 text-app">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">E-post (Microsoft 365)</h3>
                  {m365?.connected ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Tilkoblet
                    </Badge>
                  ) : (
                    <Badge variant="outline">Ikke konfigurert</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Felles avsender-konto for utgående og innkommende e-post.
                  {m365?.connected && m365.account_email && <> Konto: <strong>{m365.account_email}</strong>.</>}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/integrasjoner/ai" className="block">
        <Card className="transition hover:border-app hover:shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app/10 text-app">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">AI-tjenester</h3>
                  {aiConfigs.length > 0 ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {aiConfigs.length} aktive
                    </Badge>
                  ) : (
                    <Badge variant="outline">Ingen konfig</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Provider, modell og forbruk for AI-funksjoner. Siste 30 dager: <strong>${Number(aiCost30d).toFixed(2)}</strong>.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      {/* Generiske integrasjoner */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Generiske integrasjoner</h2>
          {!isLoading && integrations.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Ingen generiske integrasjoner er seedet ennå. Tedebe og Fiken seedes i egen prompt.
            </span>
          )}
        </div>


        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((row: any) => (
            <Link key={row.id} to={`/admin/integrasjoner/${row.integration_type}`} className="group">
              <Card className="h-full transition hover:border-app hover:shadow-sm">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app/10 text-app">
                      <Plug className="h-5 w-5" />
                    </div>
                    <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="font-semibold group-hover:text-app">{row.display_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {row.description ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {row.last_sync_at
                        ? `Sist sync ${new Date(row.last_sync_at).toLocaleString("nb-NO")}`
                        : "Aldri synket"}
                    </span>
                    {row.consecutive_errors > 0 && (
                      <span className="text-destructive">
                        {row.consecutive_errors} feil på rad
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {visiblePlaceholders.map((p) => (
            <Card key={p.type} className="h-full opacity-60">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Plug className="h-5 w-5" />
                  </div>
                  <Badge variant="outline">Kommer</Badge>
                </div>
                <div>
                  <h3 className="font-semibold text-muted-foreground">{p.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{p.desc}</p>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Seedes i egen prompt.
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
