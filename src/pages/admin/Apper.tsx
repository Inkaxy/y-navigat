import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { AppWindow, Activity, Users, Layers, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { hasAppInternalRoute } from "@/lib/appRoutes";

const STATUSES = ["planned", "in_development", "active", "deprecated", "disabled"] as const;

const STATUS_LABEL: Record<string, string> = {
  planned: "Planlagt",
  in_development: "Under utvikling",
  active: "Aktiv",
  deprecated: "Deprecated",
  disabled: "Deaktivert",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  in_development: "secondary",
  planned: "outline",
  deprecated: "outline",
  disabled: "destructive",
};

type App = {
  id: string;
  code: string;
  display_name: string;
  status: string;
  category: string;
  color_hex: string;
  sort_order: number;
};

type AuditRow = { source_app: string | null; user_id: string | null; occurred_at: string };
type AccessRow = { app_id: string; level: string };

type Stats = {
  events7: number;
  events30: number;
  users7: Set<string>;
  users30: Set<string>;
  lastEvent: string | null;
};

const emptyStats = (): Stats => ({
  events7: 0,
  events30: 0,
  users7: new Set(),
  users30: new Set(),
  lastEvent: null,
});

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "akkurat nå";
  if (min < 60) return `${min}m siden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}t siden`;
  const d = Math.floor(hr / 24);
  if (d === 1) return "i går";
  if (d < 30) return `${d}d siden`;
  const mo = Math.floor(d / 30);
  return `${mo}mnd siden`;
}

function formatExact(iso: string | null): string {
  if (!iso) return "Ingen aktivitet registrert";
  return new Date(iso).toLocaleString("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Apper() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [onlyActive, setOnlyActive] = useState(false);

  const { data: apps = [], isLoading: loadingApps } = useQuery({
    queryKey: ["admin-apps-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apps")
        .select("id, code, display_name, status, category, color_hex, sort_order")
        .order("sort_order");
      if (error) throw error;
      return data as App[];
    },
  });

  const since30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const { data: auditRows = [], isLoading: loadingAudit } = useQuery({
    queryKey: ["admin-apps-audit", since30],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("source_app, user_id, occurred_at")
        .gte("occurred_at", since30)
        .order("occurred_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const { data: accessRows = [], isLoading: loadingAccess } = useQuery({
    queryKey: ["admin-apps-access"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("position_app_access")
        .select("app_id, level");
      if (error) throw error;
      return (data ?? []) as AccessRow[];
    },
  });

  const isLoading = loadingApps || loadingAudit || loadingAccess;

  // Aggregér audit per source_app
  const statsByCode = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    const map = new Map<string, Stats>();
    for (const row of auditRows) {
      if (!row.source_app) continue;
      const key = row.source_app;
      if (!map.has(key)) map.set(key, emptyStats());
      const s = map.get(key)!;
      const ts = new Date(row.occurred_at).getTime();
      s.events30 += 1;
      if (row.user_id) s.users30.add(row.user_id);
      if (ts >= sevenDaysAgo) {
        s.events7 += 1;
        if (row.user_id) s.users7.add(row.user_id);
      }
      if (!s.lastEvent || row.occurred_at > s.lastEvent) {
        s.lastEvent = row.occurred_at;
      }
    }
    return map;
  }, [auditRows]);

  // Aggregér tilganger per app_id
  const accessById = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of accessRows) {
      if (!map.has(row.app_id)) map.set(row.app_id, {});
      const m = map.get(row.app_id)!;
      m[row.level] = (m[row.level] ?? 0) + 1;
    }
    return map;
  }, [accessRows]);

  // KPI-er
  const kpis = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    let events7 = 0;
    const users7 = new Set<string>();
    for (const row of auditRows) {
      const ts = new Date(row.occurred_at).getTime();
      if (ts >= sevenDaysAgo) {
        events7 += 1;
        if (row.user_id) users7.add(row.user_id);
      }
    }
    const totals = {
      total: apps.length,
      active: apps.filter((a) => a.status === "active").length,
      inDev: apps.filter((a) => a.status === "in_development").length,
      planned: apps.filter((a) => a.status === "planned").length,
      events7,
      users7: users7.size,
      stale: apps.filter((a) => {
        if (a.status === "planned" || a.status === "deprecated") return false;
        const s = statsByCode.get(a.code);
        return !s || s.events30 === 0;
      }).length,
    };
    return totals;
  }, [apps, auditRows, statsByCode]);

  const categories = useMemo(() => {
    const set = new Set(apps.map((a) => a.category));
    return Array.from(set).sort();
  }, [apps]);

  const rows = useMemo(() => {
    return apps
      .filter((a) => statusFilter === "all" || a.status === statusFilter)
      .filter((a) => categoryFilter === "all" || a.category === categoryFilter)
      .filter((a) => {
        if (!onlyActive) return true;
        const s = statsByCode.get(a.code);
        return !!s && s.events30 > 0;
      });
  }, [apps, statusFilter, categoryFilter, onlyActive, statsByCode]);

  return (
    <AdminLayout title="Apper">
      <AppHeaderBanner
        icon={AppWindow}
        title="Apper"
        subtitle="Bruks- og helseoversikt over registrerte NBOS-apper."
      />

      {/* KPI-kort */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Layers}
          label="Apper totalt"
          value={kpis.total}
          hint={`${kpis.active} aktive · ${kpis.inDev} u/utvikling · ${kpis.planned} planlagt`}
        />
        <KpiCard
          icon={Activity}
          label="Hendelser siste 7d"
          value={kpis.events7}
          hint="På tvers av alle apper"
        />
        <KpiCard
          icon={Users}
          label="Aktive brukere 7d"
          value={kpis.users7}
          hint="Unike brukere med aktivitet"
        />
        <KpiCard
          icon={Clock}
          label="Uten aktivitet 30d"
          value={kpis.stale}
          hint="Apper som kan trenge oppfølging"
        />
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle statuser</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kategorier</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="only-active" checked={onlyActive} onCheckedChange={setOnlyActive} />
          <Label htmlFor="only-active" className="text-sm cursor-pointer">
            Vis kun apper med aktivitet siste 30d
          </Label>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {rows.length} av {apps.length} apper
        </div>
      </div>

      {/* Tabell */}
      <TooltipProvider delayDuration={200}>
        <div className="rounded-md border border-line bg-surface-canvas">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right">7d</TableHead>
                <TableHead className="text-right">30d</TableHead>
                <TableHead className="text-right">Brukere 30d</TableHead>
                <TableHead>Siste aktivitet</TableHead>
                <TableHead>Tilganger</TableHead>
                <TableHead>Integrert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                    Laster…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                    Ingen apper matcher filtrene.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.map((a) => {
                const s = statsByCode.get(a.code);
                const access = accessById.get(a.id) ?? {};
                const integrated = hasAppInternalRoute(a.code);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: a.color_hex }}
                        />
                        <div>
                          <div className="font-medium">{a.display_name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{a.code}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {a.category}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.events7 ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.events30 ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.users30.size ?? 0}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground cursor-help">
                            {formatRelative(s?.lastEvent ?? null)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{formatExact(s?.lastEvent ?? null)}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(access).length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          Object.entries(access).map(([level, count]) => (
                            <Badge
                              key={level}
                              variant="outline"
                              className="text-[10px]"
                              title={`${count} stilling${count === 1 ? "" : "er"} med ${level}-tilgang`}
                            >
                              {level}: {count}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {integrated ? (
                        <Badge variant="default" className="text-[10px]">I NBhub</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Ikke ennå</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>
    </AdminLayout>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
