import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, CheckCircle2, AlertCircle, Settings2 } from "lucide-react";

type M365Status = {
  connected: boolean;
  account_email: string | null;
  scope: string | null;
  tenant_id: string | null;
  expires_at: string | null;
  connected_at: string | null;
  last_refresh_at: string | null;
};

export default function EmailM365Integrasjon() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["admin-email-m365-status"],
    queryFn: async (): Promise<M365Status | null> => {
      const { data, error } = await (supabase as any).rpc("get_email_m365_status");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as M365Status) ?? null;
    },
  });

  const { data: emailStats } = useQuery({
    queryKey: ["admin-email-m365-stats-30d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from("email_send_log")
        .select("message_id, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return { total: 0, sent: 0, failed: 0, suppressed: 0 };
      const latestByMsg = new Map<string, string>();
      for (const r of (data as any[]) ?? []) {
        const key = r.message_id ?? r.created_at;
        if (!latestByMsg.has(key)) latestByMsg.set(key, r.status);
      }
      let sent = 0, failed = 0, suppressed = 0;
      for (const st of latestByMsg.values()) {
        if (st === "sent") sent++;
        else if (st === "dlq" || st === "failed" || st === "bounced") failed++;
        else if (st === "suppressed") suppressed++;
      }
      return { total: latestByMsg.size, sent, failed, suppressed };
    },
  });

  const connected = !!status?.connected;

  return (
    <AdminLayout title="E-post (Microsoft 365)">
      <AppHeaderBanner
        icon={Mail}
        title="E-post (Microsoft 365)"
        subtitle="Felles avsender-konto for utgående og innkommende e-post."
      />

      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/integrasjoner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Til integrasjoner
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/ordre/innstillinger" className="inline-flex items-center gap-1.5">
            <Settings2 className="h-4 w-4" /> Administrer tilkobling
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Tilkoblet konto</span>
            {isLoading ? null : connected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Tilkoblet
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Ikke konfigurert
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading ? (
            <p className="text-muted-foreground">Laster …</p>
          ) : connected ? (
            <>
              <div><span className="text-muted-foreground">E-post:</span> <strong>{status?.account_email}</strong></div>
              {status?.tenant_id && (
                <div className="text-xs text-muted-foreground">Tenant: <span className="font-mono">{status.tenant_id}</span></div>
              )}
              {status?.connected_at && (
                <div className="text-xs text-muted-foreground">
                  Koblet til {new Date(status.connected_at).toLocaleString("nb-NO")}
                </div>
              )}
              {status?.last_refresh_at && (
                <div className="text-xs text-muted-foreground">
                  Token sist fornyet {new Date(status.last_refresh_at).toLocaleString("nb-NO")}
                </div>
              )}
              {status?.expires_at && (
                <div className="text-xs text-muted-foreground">
                  Token utløper {new Date(status.expires_at).toLocaleString("nb-NO")}
                </div>
              )}
              {status?.scope && (
                <div className="text-xs text-muted-foreground break-all">Scope: {status.scope}</div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Ingen konto er koblet til. Gå til Ordre → Innstillinger for å koble til en Microsoft 365-konto.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forbruk siste 30 dager</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Unike e-poster" value={emailStats?.total ?? 0} />
            <Stat label="Sendt" value={emailStats?.sent ?? 0} />
            <Stat label="Feilet" value={emailStats?.failed ?? 0} />
            <Stat label="Suppressed" value={emailStats?.suppressed ?? 0} />
          </div>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
