import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollText } from "lucide-react";
import { PlatformAdminGuard } from "@/components/auth/PlatformAdminGuard";

export default function Audit() {
  return (
    <AdminLayout title="Audit">
      <PlatformAdminGuard title="Audit-loggen">
        <AuditView />
      </PlatformAdminGuard>
    </AdminLayout>
  );
}

function AuditView() {
  const [sourceApp, setSourceApp] = useState("all");
  const [action, setAction] = useState("all");
  const [days, setDays] = useState("7");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    return d.toISOString();
  }, [days]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit-log", since, sourceApp, action],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("id, occurred_at, user_display_name, action, entity_type, entity_id, entity_display_reference, source_app, legal_entity_id, changes, reason")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (sourceApp !== "all") q = q.eq("source_app", sourceApp);
      if (action !== "all") q = q.eq("action", action);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const sourceApps = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.source_app).filter(Boolean))).sort(),
    [rows],
  );
  const actions = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.action))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      [r.entity_type, r.entity_display_reference, r.user_display_name, r.action, r.entity_id]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, search]);

  return (
    <>
      <AppHeaderBanner
        icon={ScrollText}
        title="Audit"
        subtitle="Endringslogg og sikkerhetshendelser på tvers av apper."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">App</label>
          <Select value={sourceApp} onValueChange={setSourceApp}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle apper</SelectItem>
              {sourceApps.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Handling</label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle handlinger</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
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
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Søk</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Entitet, bruker, ID…" />
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length} av {rows.length} rader
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">Tidspunkt</TableHead>
                <TableHead>Bruker</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Handling</TableHead>
                <TableHead>Entitet</TableHead>
                <TableHead>Referanse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Laster…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Ingen rader matcher.</TableCell></TableRow>
              )}
              {filtered.map((r: any) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(r)}>
                  <TableCell className="text-xs tabular-nums">{new Date(r.occurred_at).toLocaleString("nb-NO")}</TableCell>
                  <TableCell className="text-sm">{r.user_display_name ?? <span className="text-muted-foreground">system</span>}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{r.source_app ?? "—"}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">{r.entity_type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]">
                    {r.entity_display_reference ?? r.entity_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Audit-detaljer</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <KV label="Tidspunkt" value={new Date(selected.occurred_at).toLocaleString("nb-NO")} />
                <KV label="Bruker" value={selected.user_display_name ?? "system"} />
                <KV label="App" value={selected.source_app ?? "—"} />
                <KV label="Handling" value={selected.action} />
                <KV label="Entitet" value={selected.entity_type} />
                <KV label="Referanse" value={selected.entity_display_reference ?? selected.entity_id ?? "—"} />
              </div>
              {selected.reason && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Begrunnelse</div>
                  <div className="rounded-md border border-line bg-surface-canvas p-3">{selected.reason}</div>
                </div>
              )}
              {selected.changes && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Endringer</div>
                  <div className="rounded-md border border-line bg-surface-canvas p-3">
                    <JsonTree value={selected.changes} />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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

/** Lett rekursiv JSON-tree-renderer (kollapsbar). */
function JsonTree({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value !== "object") {
    if (typeof value === "string") return <span className="text-emerald-700 dark:text-emerald-400">"{value}"</span>;
    if (typeof value === "number") return <span className="text-blue-700 dark:text-blue-400 tabular-nums">{value}</span>;
    if (typeof value === "boolean") return <span className="text-purple-700 dark:text-purple-400">{String(value)}</span>;
    return <span>{String(value)}</span>;
  }
  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v: any, i: number) => [i, v]) : Object.entries(value);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{isArray ? "[]" : "{}"}</span>;
  }
  return (
    <details open={depth < 2} className="ml-2">
      <summary className="cursor-pointer text-xs text-muted-foreground select-none">
        {isArray ? `[${entries.length}]` : `{${entries.length}}`}
      </summary>
      <ul className="ml-3 border-l border-line/60 pl-3 space-y-0.5">
        {entries.map(([k, v]) => (
          <li key={String(k)} className="text-xs font-mono">
            <span className="text-foreground/80">{String(k)}</span>
            <span className="text-muted-foreground">: </span>
            <JsonTree value={v} depth={depth + 1} />
          </li>
        ))}
      </ul>
    </details>
  );
}
