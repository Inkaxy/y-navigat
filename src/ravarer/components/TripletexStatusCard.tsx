import { Link } from "react-router-dom";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

export function TripletexStatusCard() {
  const { data: entities = [] } = useFakturaerLegalEntities();
  const { data: creds = [] } = useQuery({
    queryKey: ["tripletex-creds-overview", entities.map((e) => e.id).join(",")],
    enabled: entities.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tripletex_credentials")
        .select("legal_entity_id, sync_enabled, last_synced_at, last_sync_status, last_sync_error")
        .in("legal_entity_id", entities.map((e) => e.id));
      if (error) throw error;
      return data ?? [];
    },
  });

  if (entities.length === 0) return null;

  const configured = creds.length;
  const errors = creds.filter((c: any) => c.last_sync_status === "error");
  const lastSync = creds
    .map((c: any) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  return (
    <Card className="border-line-subtle">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">Tripletex-integrasjon</h3>
              {configured === 0 ? (
                <Badge variant="outline">Ikke konfigurert</Badge>
              ) : errors.length > 0 ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />Feil på {errors.length}
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />{configured}/{entities.length} aktive
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {configured === 0
                ? "Importer fakturaer manuelt under \"Importer manuelt\", eller koble til Tripletex."
                : lastSync
                  ? <>Sist synket {new Date(lastSync).toLocaleString("nb-NO")}</>
                  : "Klar – ingen sync kjørt ennå."}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/admin/integrasjoner/tripletex">
            <RefreshCw className="h-4 w-4" />
            {configured === 0 ? "Konfigurer Tripletex" : "Administrer"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
