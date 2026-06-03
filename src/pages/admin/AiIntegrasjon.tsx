import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Sparkles, Settings2 } from "lucide-react";

type Range = "24h" | "7d" | "30d";

function rangeStart(r: Range) {
  const ms = r === "24h" ? 24 * 3600e3 : r === "7d" ? 7 * 86400e3 : 30 * 86400e3;
  return new Date(Date.now() - ms).toISOString();
}

export default function AiIntegrasjon() {
  const [range, setRange] = useState<Range>("30d");

  const { data: configs = [] } = useQuery({
    queryKey: ["admin-ai-configs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_provider_config")
        .select("id, provider, model, purpose, is_active, max_tokens, temperature, azure_deployment, updated_at")
        .order("purpose")
        .order("is_active", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: usage = [] } = useQuery({
    queryKey: ["admin-ai-usage", range],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_usage_log")
        .select("provider, model, purpose, input_tokens, output_tokens, estimated_cost_usd, success, created_at")
        .gte("created_at", rangeStart(range))
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = useMemo(() => {
    let calls = 0, ok = 0, tin = 0, tout = 0, cost = 0;
    for (const u of usage as any[]) {
      calls++;
      if (u.success) ok++;
      tin += u.input_tokens ?? 0;
      tout += u.output_tokens ?? 0;
      cost += Number(u.estimated_cost_usd ?? 0);
    }
    return { calls, ok, tin, tout, cost, rate: calls ? (ok / calls) * 100 : 0 };
  }, [usage]);

  const grouped = useMemo(() => {
    const m = new Map<string, { provider: string; model: string; purpose: string; calls: number; ok: number; tin: number; tout: number; cost: number }>();
    for (const u of usage as any[]) {
      const key = `${u.purpose}|${u.provider}|${u.model}`;
      const cur = m.get(key) ?? { provider: u.provider, model: u.model, purpose: u.purpose, calls: 0, ok: 0, tin: 0, tout: 0, cost: 0 };
      cur.calls++;
      if (u.success) cur.ok++;
      cur.tin += u.input_tokens ?? 0;
      cur.tout += u.output_tokens ?? 0;
      cur.cost += Number(u.estimated_cost_usd ?? 0);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  }, [usage]);

  return (
    <AdminLayout title="AI-tjenester">
      <AppHeaderBanner
        icon={Sparkles}
        title="AI-tjenester"
        subtitle="Provider, modell og forbruk for AI-funksjoner i plattformen."
      />

      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/integrasjoner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Til integrasjoner
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/ravarer/innstillinger/ai-tjenester" className="inline-flex items-center gap-1.5">
            <Settings2 className="h-4 w-4" /> Rediger AI-konfig
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aktive konfigurasjoner</CardTitle>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen AI-konfig opprettet ennå.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Formål</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Modell</TableHead>
                  <TableHead className="text-right">Max tokens</TableHead>
                  <TableHead className="text-right">Temperatur</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(configs as any[]).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.purpose}</TableCell>
                    <TableCell>{c.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{c.model}{c.azure_deployment ? ` (${c.azure_deployment})` : ""}</TableCell>
                    <TableCell className="text-right">{c.max_tokens}</TableCell>
                    <TableCell className="text-right">{Number(c.temperature).toFixed(2)}</TableCell>
                    <TableCell>
                      {c.is_active ? (
                        <Badge variant="default">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline">Inaktiv</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Forbruk</span>
            <div className="flex gap-1">
              {(["24h", "7d", "30d"] as Range[]).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={range === r ? "default" : "outline"}
                  onClick={() => setRange(r)}
                >
                  {r === "24h" ? "24 t" : r === "7d" ? "7 dager" : "30 dager"}
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Kall" value={totals.calls.toLocaleString("nb-NO")} />
            <Stat label="Suksessrate" value={`${totals.rate.toFixed(1)} %`} />
            <Stat label="Tokens inn" value={totals.tin.toLocaleString("nb-NO")} />
            <Stat label="Tokens ut" value={totals.tout.toLocaleString("nb-NO")} />
            <Stat label="Kost (USD)" value={`$${totals.cost.toFixed(2)}`} />
          </div>

          {grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen forbruk registrert i valgt periode.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Formål</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Modell</TableHead>
                  <TableHead className="text-right">Kall</TableHead>
                  <TableHead className="text-right">Suksess</TableHead>
                  <TableHead className="text-right">Tokens inn</TableHead>
                  <TableHead className="text-right">Tokens ut</TableHead>
                  <TableHead className="text-right">Kost (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((g, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{g.purpose}</TableCell>
                    <TableCell>{g.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{g.model}</TableCell>
                    <TableCell className="text-right">{g.calls.toLocaleString("nb-NO")}</TableCell>
                    <TableCell className="text-right">{g.ok}</TableCell>
                    <TableCell className="text-right">{g.tin.toLocaleString("nb-NO")}</TableCell>
                    <TableCell className="text-right">{g.tout.toLocaleString("nb-NO")}</TableCell>
                    <TableCell className="text-right">${g.cost.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
