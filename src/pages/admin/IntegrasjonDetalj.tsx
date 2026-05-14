import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, KeyRound } from "lucide-react";

// TODO: Add test connection RPC + button in later prompt.

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv", error: "Feil", disabled: "Deaktivert", configuring: "Konfigureres",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default", error: "destructive", disabled: "outline", configuring: "secondary",
};

export default function IntegrasjonDetalj() {
  const { integrationType } = useParams<{ integrationType: string }>();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-integration-detail", integrationType],
    enabled: !!integrationType,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("*, legal_entities(legal_name, short_code)")
        .eq("integration_type", integrationType!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const first = rows[0] as any;
  const title = first?.display_name ?? integrationType ?? "Integrasjon";

  return (
    <AdminLayout title={title}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/integrasjoner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Til integrasjoner
          </Link>
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Laster…</p>}
      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Ingen rader for <span className="font-mono">{integrationType}</span>. Seedes i egen prompt.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map((row: any) => (
          <Card key={row.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {row.legal_entities?.legal_name ?? row.legal_entity_id}
                </CardTitle>
                <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.description && (
                <p className="text-sm text-muted-foreground">{row.description}</p>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <KV label="Sist sync" value={row.last_sync_at ? new Date(row.last_sync_at).toLocaleString("nb-NO") : "—"} />
                <KV label="Sist feil" value={row.last_error_at ? new Date(row.last_error_at).toLocaleString("nb-NO") : "—"} />
                <KV label="Feil på rad" value={String(row.consecutive_errors ?? 0)} />
                <KV label="Config v" value={String(row.config_version ?? 1)} />
              </div>

              {row.last_error_message && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {row.last_error_message}
                </div>
              )}

              {/* Hemmeligheter — alltid maskert */}
              <div className="rounded-md border border-line bg-surface-canvas p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Hemmelighet</span>
                    <span className="font-mono text-muted-foreground">••••••••</span>
                  </div>
                  <Button size="sm" variant="outline" disabled>
                    Endre
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Vault-nøkkel: <span className="font-mono">{row.secrets_vault_key ?? "—"}</span>. Klartekst vises aldri.
                </p>
              </div>

              {row.notes && (
                <div className="text-xs text-muted-foreground">{row.notes}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminLayout>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
