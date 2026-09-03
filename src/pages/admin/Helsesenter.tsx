import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { HeartPulse, RefreshCw } from "lucide-react";

const SEVERITIES = ["info", "warning", "error", "critical"] as const;
const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  info: "secondary", warning: "outline", error: "destructive", critical: "destructive",
};

export default function Helsesenter() {
  const [severity, setSeverity] = useState<string>("all");
  const [integrationId, setIntegrationId] = useState<string>("all");
  const [days, setDays] = useState<string>("7");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedError, setSelectedError] = useState<any | null>(null);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    return d.toISOString();
  }, [days]);

  const { data: integrations = [] } = useQuery({
    queryKey: ["helsesenter-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, integration_type, display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ["helsesenter-events", since, severity, integrationId],
    queryFn: async () => {
      let q = supabase
        .from("integration_events")
        .select("id, occurred_at, integration_id, event_type, severity, message, details, integrations(display_name, integration_type)")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (severity !== "all") q = q.eq("severity", severity);
      if (integrationId !== "all") q = q.eq("integration_id", integrationId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Automatisk fangede frontend-feil (skrives av logAppError → bug_reports)
  const {
    data: autoErrors = [],
    isLoading: autoLoading,
    error: autoError,
    refetch: refetchAuto,
  } = useQuery({
    queryKey: ["helsesenter-auto-errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bug_reports")
        .select("id, occurred_at, title, description, source_url, user_agent, screen_size, console_errors")
        .eq("source_app", "nbhub")
        .like("title", "[auto]%")
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Polling 30s
  useEffect(() => {
    const id = setInterval(() => {
      refetch();
      setLastUpdate(new Date());
    }, 30000);
    return () => clearInterval(id);
  }, [refetch]);

  return (
    <AdminLayout title="Helsesenter">
      <AppHeaderBanner
        icon={HeartPulse}
        title="Helsesenter"
        subtitle="Hendelser og diagnostikk fra integrasjoner."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Integrasjon</label>
          <Select value={integrationId} onValueChange={setIntegrationId}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle integrasjoner</SelectItem>
              {integrations.map((i: any) => (
                <SelectItem key={i.id} value={i.id}>{i.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Severity</label>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Periode</label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 dag</SelectItem>
              <SelectItem value="7">7 dager</SelectItem>
              <SelectItem value="30">30 dager</SelectItem>
              <SelectItem value="90">90 dager</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            Sist oppdatert {lastUpdate.toLocaleTimeString("nb-NO")} · auto-refresh 30s
          </span>
          <Button size="sm" variant="outline" onClick={() => { refetch(); setLastUpdate(new Date()); }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Oppdater
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Automatisk fangede feil</h2>
              <p className="text-xs text-muted-foreground">
                De 20 nyeste frontend-feilene som ble logget automatisk.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetchAuto()}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Oppdater
            </Button>
          </div>
          {autoLoading && <p className="text-sm text-muted-foreground">Laster…</p>}
          {autoError && (
            <p className="text-sm text-destructive">Kunne ikke hente automatiske feil.</p>
          )}
          {!autoLoading && !autoError && autoErrors.length === 0 && (
            <p className="text-sm text-muted-foreground">Ingen automatisk fangede feil.</p>
          )}
          {autoErrors.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Tidspunkt</TableHead>
                  <TableHead className="w-[150px]">Feil-ID</TableHead>
                  <TableHead>Melding</TableHead>
                  <TableHead className="w-[220px]">Rute</TableHead>
                  <TableHead className="w-[120px]">Enhet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {autoErrors.map((r: any) => {
                  const meta = (r.console_errors ?? {}) as Record<string, any>;
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedError(r)}>
                      <TableCell className="text-xs tabular-nums">
                        {new Date(r.occurred_at).toLocaleString("nb-NO")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{meta.errorId ?? "—"}</TableCell>
                      <TableCell className="max-w-[420px] truncate text-sm">
                        {meta.message ?? r.title}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs">
                        {meta.path ?? r.source_url ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.screen_size ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedError} onOpenChange={(o) => !o && setSelectedError(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Automatisk fanget feil</DialogTitle>
          </DialogHeader>
          {selectedError && (
            <div className="space-y-3 text-sm">
              <KV label="Tidspunkt" value={new Date(selectedError.occurred_at).toLocaleString("nb-NO")} />
              <KV label="Nettleser" value={selectedError.user_agent ?? "—"} />
              <KV label="URL" value={selectedError.source_url ?? "—"} />
              <pre className="max-h-80 overflow-auto rounded-md border border-line bg-surface-canvas p-3 text-xs whitespace-pre-wrap">
                {selectedError.description}
              </pre>
              <pre className="max-h-60 overflow-auto rounded-md border border-line bg-surface-canvas p-3 text-xs">
                {JSON.stringify(selectedError.console_errors, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">Tidspunkt</TableHead>
                <TableHead>Integrasjon</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Melding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Laster…</TableCell></TableRow>
              )}
              {!isLoading && events.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Ingen hendelser i valgt periode.</TableCell></TableRow>
              )}
              {events.map((e: any) => (
                <TableRow key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(e)}>
                  <TableCell className="text-xs tabular-nums">
                    {new Date(e.occurred_at).toLocaleString("nb-NO")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.integrations?.display_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{e.event_type}</TableCell>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[e.severity] ?? "secondary"}>{e.severity}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[480px] truncate text-sm">{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Hendelse</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <KV label="Tidspunkt" value={new Date(selected.occurred_at).toLocaleString("nb-NO")} />
                <KV label="Integrasjon" value={selected.integrations?.display_name ?? "—"} />
                <KV label="Type" value={selected.event_type} />
                <KV label="Severity" value={selected.severity} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Melding</div>
                <div className="rounded-md border border-line bg-surface-canvas p-3 text-sm whitespace-pre-wrap">
                  {selected.message}
                </div>
              </div>
              {selected.details && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Detaljer</div>
                  <pre className="rounded-md border border-line bg-surface-canvas p-3 text-xs overflow-auto max-h-80">
                    {JSON.stringify(selected.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
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
