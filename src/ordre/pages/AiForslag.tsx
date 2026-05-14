import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Sparkles, ExternalLink, AlertCircle, Loader2 } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface CallLogRow {
  id: string;
  ticket_id: string | null;
  provider: string;
  model: string;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  confidence_score: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  request_payload: any;
  response_payload: any;
}

const STATUS_OPTS = [
  { value: "all", label: "Alle statuser" },
  { value: "success", label: "Suksess" },
  { value: "error", label: "Feil" },
  { value: "rate_limited", label: "Rate limit" },
];

const PROVIDER_OPTS = [
  { value: "all", label: "Alle providere" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
];

export default function AiForslagPage() {
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState("all");
  const [provider, setProvider] = useState("all");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["ai_call_log", days, status, provider],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      let q = supabase
        .from("ai_call_log")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (status !== "all") q = q.eq("status", status);
      if (provider !== "all") q = q.eq("provider", provider);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CallLogRow[];
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const total = list.length;
    const success = list.filter((r) => r.status === "success").length;
    const cost = list.reduce((acc, r) => acc + (r.cost_usd ?? 0), 0);
    const avg = total > 0 ? cost / total : 0;
    const successRate = total > 0 ? success / total : 0;
    return { total, success, cost, avg, successRate };
  }, [rows]);

  return (
    <>
      <AppBanner title="AI-forslag" subtitle="Audit av alle AI-analyser av tickets" />
      <div className="container mx-auto max-w-6xl p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Antall kall" value={summary.total.toString()} />
          <SummaryCard label="Total kostnad" value={`$${summary.cost.toFixed(4)}`} />
          <SummaryCard label="Snitt-kost" value={`$${summary.avg.toFixed(4)}`} />
          <SummaryCard label="Suksess-rate" value={`${Math.round(summary.successRate * 100)}%`} />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Kall-logg
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Periode (dager)</Label>
                <Input
                  type="number" min={1} max={365}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 30)))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (rows?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Ingen kall i valgt periode.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">Tidspunkt</th>
                      <th className="py-2 pr-2">Provider / modell</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2 pr-2 text-right">Tokens (in/out)</th>
                      <th className="py-2 pr-2 text-right">Kost</th>
                      <th className="py-2 pr-2 text-right">Conf.</th>
                      <th className="py-2 pr-2 text-right">Tid</th>
                      <th className="py-2 pr-2">Ticket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows!.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-muted/40">
                        <td className="py-2 pr-2 whitespace-nowrap text-xs">
                          {format(new Date(r.created_at), "d. MMM HH:mm:ss", { locale: nb })}
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          <div>{r.provider}</div>
                          <div className="text-muted-foreground">{r.model}</div>
                        </td>
                        <td className="py-2 pr-2">
                          <StatusBadge status={r.status} />
                          {r.error && (
                            <div className="text-[11px] text-rose-700 mt-1 max-w-xs truncate" title={r.error}>
                              <AlertCircle className="inline h-3 w-3 mr-1" />{r.error}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-xs">
                          {r.prompt_tokens ?? "—"} / {r.completion_tokens ?? "—"}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-xs">
                          {r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : "—"}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-xs">
                          {r.confidence_score != null ? `${Math.round(r.confidence_score * 100)}%` : "—"}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-xs">
                          {r.duration_ms != null ? `${r.duration_ms} ms` : "—"}
                        </td>
                        <td className="py-2 pr-2">
                          {r.ticket_id ? (
                            <Link to={`/ordre/ticket/${r.ticket_id}`} className="text-primary inline-flex items-center gap-1 text-xs hover:underline">
                              <ExternalLink className="h-3 w-3" /> Åpne
                            </Link>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300">Suksess</Badge>;
  if (status === "rate_limited") return <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">Rate limit</Badge>;
  return <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300">Feil</Badge>;
}
