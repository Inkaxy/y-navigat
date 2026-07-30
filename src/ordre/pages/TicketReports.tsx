import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, startOfWeek, differenceInMinutes } from "date-fns";
import { nb } from "date-fns/locale";
import { BarChart3, TrendingUp, AlertTriangle, Sparkles, Mail, Package, Clock, Link2 } from "lucide-react";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { osloDateISO } from "@/lib/osloDate";

const PERIODS = [
  { value: "7", label: "Siste 7 dager" },
  { value: "14", label: "Siste 14 dager" },
  { value: "30", label: "Siste 30 dager" },
  { value: "90", label: "Siste 90 dager" },
];

const GROUPS = [
  { value: "day", label: "Per dag" },
  { value: "week", label: "Per uke" },
] as const;

type Group = (typeof GROUPS)[number]["value"];

type TicketRow = {
  id: string;
  status: string | null;
  ai_status: string | null;
  ai_suggestion: any;
  ai_analyzed_at: string | null;
  related_order_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type EventRow = {
  ticket_id: string | null;
  event_type: string;
  actor_type: string | null;
  payload: any;
  occurred_at: string;
};

export default function TicketReports() {
  const [days, setDays] = useState("30");
  const [group, setGroup] = useState<Group>("day");

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(days, 10));
    return d.toISOString();
  }, [days]);

  const { data: tickets, isLoading: tLoading } = useQuery({
    queryKey: ["ticket-reports-tickets", since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,status,ai_status,ai_suggestion,ai_analyzed_at,related_order_id,created_at,updated_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
  });

  const { data: events, isLoading: eLoading } = useQuery({
    queryKey: ["ticket-reports-events", since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_events")
        .select("ticket_id,event_type,actor_type,payload,occurred_at")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const isLoading = tLoading || eLoading;

  const metrics = useMemo(() => computeMetrics(tickets ?? [], events ?? [], group), [tickets, events, group]);

  return (
    <>
      <AppBanner title="Rapportering" subtitle="Innsikt i ticket-flyt, AI-bruk og avvik" />
      <div className="container mx-auto max-w-6xl p-4 space-y-4">
        <Card>
          <CardContent className="pt-4 flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Periode</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Gruppering</Label>
              <Select value={group} onValueChange={(v) => setGroup(v as Group)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Mail} label="Tickets totalt" value={metrics.totalTickets} />
              <Stat icon={Package} label="Ble til ny ordre" value={metrics.becameOrder} hint={pct(metrics.becameOrder, metrics.totalTickets)} />
              <Stat icon={Link2} label="Koblet til eksisterende" value={metrics.linkedExisting} hint={pct(metrics.linkedExisting, metrics.totalTickets)} />
              <Stat icon={AlertTriangle} label="Manglet informasjon" value={metrics.missingInfo} hint={pct(metrics.missingInfo, metrics.totalTickets)} />
              <Stat icon={Sparkles} label="AI-forslag brukt" value={metrics.aiUsed} hint={pct(metrics.aiUsed, metrics.aiCompleted)} />
              <Stat icon={Sparkles} label="AI-forslag endret" value={metrics.aiEdited} hint={pct(metrics.aiEdited, metrics.aiCompleted)} />
              <Stat icon={Mail} label="Kundesvar sendt" value={metrics.repliesSent} />
              <Stat icon={Clock} label="Snitt behandlingstid" value={metrics.avgHandlingLabel} />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4" /> Volum {group === "day" ? "per dag" : "per uke"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart data={metrics.timeline} />
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <RankCard
                title="Vanligste manglende felt"
                icon={AlertTriangle}
                items={metrics.missingFields}
                emptyText="Ingen tickets med manglende felt i perioden."
              />
              <RankCard
                title="Vanligste risikotyper"
                icon={AlertTriangle}
                items={metrics.riskTypes}
                emptyText="Ingen risikoflagg registrert i perioden."
              />
              <RankCard
                title="Produkter som skaper mest avklaringer"
                icon={Package}
                items={metrics.troubleProducts}
                emptyText="Ingen produktavklaringer i perioden."
              />
              <RankCard
                title="Hendelser etter type"
                icon={TrendingUp}
                items={metrics.eventCounts}
                emptyText="Ingen hendelser logget i perioden."
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function pct(part: number, total: number): string | undefined {
  if (!total) return undefined;
  return `${Math.round((part / total) * 100)}%`;
}

function computeMetrics(tickets: TicketRow[], events: EventRow[], group: Group) {
  const totalTickets = tickets.length;
  const linkedExisting = tickets.filter((t) => t.related_order_id).length;
  const aiCompleted = tickets.filter((t) => t.ai_status === "completed").length;

  // Events
  const evByType = new Map<string, number>();
  for (const e of events) evByType.set(e.event_type, (evByType.get(e.event_type) ?? 0) + 1);

  const becameOrder = evByType.get("order.created_from_ticket") ?? 0;
  const aiEdited = evByType.get("ai.suggestion_edited") ?? 0;
  const repliesSent = (evByType.get("reply.sent") ?? 0) + (evByType.get("confirmation.sent") ?? 0);

  // AI used = ticket linked to order AND had ai_suggestion
  const aiUsed = tickets.filter((t) => t.ai_suggestion && (t.related_order_id || hasOrderCreatedEvent(t.id, events))).length;

  // Missing info heuristic
  const missingFieldCount = new Map<string, number>();
  let missingInfo = 0;
  for (const t of tickets) {
    const missing = detectMissingFields(t.ai_suggestion);
    if (missing.length > 0) {
      missingInfo++;
      for (const f of missing) missingFieldCount.set(f, (missingFieldCount.get(f) ?? 0) + 1);
    }
  }

  // Risk types — from ai_suggestion.risks or .risk_flags or low confidence
  const riskCount = new Map<string, number>();
  for (const t of tickets) {
    for (const r of detectRisks(t.ai_suggestion)) {
      riskCount.set(r, (riskCount.get(r) ?? 0) + 1);
    }
  }

  // Trouble products: products in suggestions without a product_id match
  const productCount = new Map<string, number>();
  for (const t of tickets) {
    const products = t.ai_suggestion?.products as Array<any> | undefined;
    if (!Array.isArray(products)) continue;
    for (const p of products) {
      if (!p?.product_id) {
        const name = (p?.product_name ?? "Ukjent produkt").toString().trim();
        if (name) productCount.set(name, (productCount.get(name) ?? 0) + 1);
      }
    }
  }

  // Avg handling time = ticket.received → ticket.resolved (per ticket)
  const receivedMap = new Map<string, Date>();
  const resolvedMap = new Map<string, Date>();
  for (const t of tickets) receivedMap.set(t.id, new Date(t.created_at));
  for (const e of events) {
    if (!e.ticket_id) continue;
    if (e.event_type === "ticket.resolved") resolvedMap.set(e.ticket_id, new Date(e.occurred_at));
  }
  const handlingMins: number[] = [];
  for (const [tid, recv] of receivedMap) {
    const res = resolvedMap.get(tid);
    if (res) handlingMins.push(differenceInMinutes(res, recv));
  }
  const avgMin = handlingMins.length ? Math.round(handlingMins.reduce((a, b) => a + b, 0) / handlingMins.length) : null;

  // Timeline
  const buckets = new Map<string, number>();
  for (const t of tickets) {
    const d = new Date(t.created_at);
    const key = group === "day"
      ? osloDateISO(startOfDay(d))
      : osloDateISO(startOfWeek(d, { weekStartsOn: 1 }));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const timeline = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value,
      label: group === "day"
        ? format(new Date(key), "d. MMM", { locale: nb })
        : `Uke ${format(new Date(key), "I", { locale: nb })}`,
    }));

  return {
    totalTickets,
    becameOrder,
    linkedExisting,
    missingInfo,
    aiUsed,
    aiEdited,
    aiCompleted,
    repliesSent,
    avgHandlingLabel: avgMin == null ? "—" : avgMin < 60 ? `${avgMin} min` : `${(avgMin / 60).toFixed(1)} t`,
    timeline,
    missingFields: toRanked(missingFieldCount),
    riskTypes: toRanked(riskCount),
    troubleProducts: toRanked(productCount).slice(0, 10),
    eventCounts: toRanked(evByType),
  };
}

function hasOrderCreatedEvent(ticketId: string, events: EventRow[]): boolean {
  return events.some((e) => e.ticket_id === ticketId && e.event_type === "order.created_from_ticket");
}

function detectMissingFields(s: any): string[] {
  if (!s) return [];
  const missing: string[] = [];
  if (!s.delivery_date) missing.push("Hentedato");
  if (!s.customer_match?.customer_id) missing.push("Kunde");
  const products = Array.isArray(s.products) ? s.products : [];
  if (products.length === 0) missing.push("Produkt");
  else if (products.some((p: any) => !p?.product_id)) missing.push("Produkt-match");
  if (!s.tour && !s.pickup_location_hint && !s.outlet_id) missing.push("Hentested");
  return missing;
}

function detectRisks(s: any): string[] {
  if (!s) return [];
  const out: string[] = [];
  const arr = (s.risks ?? s.risk_flags ?? []) as any[];
  if (Array.isArray(arr)) {
    for (const r of arr) {
      const label = typeof r === "string" ? r : (r?.type ?? r?.label ?? r?.code);
      if (label) out.push(String(label));
    }
  }
  if (typeof s.confidence_score === "number" && s.confidence_score < 0.6) out.push("Lav AI-konfidens");
  if (s.customer_match && !s.customer_match.customer_id) out.push("Kunde ikke funnet");
  if (Array.isArray(s.products) && s.products.some((p: any) => !p?.product_id)) out.push("Produkt ikke funnet");
  return out;
}

function toRanked(map: Map<string, number>): { label: string; value: number }[] {
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({ label, value }));
}

function Stat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BarChart({ data }: { data: { key: string; label: string; value: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Ingen data i perioden.</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-40">
      {data.map((d) => (
        <div key={d.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="text-[10px] tabular-nums text-muted-foreground">{d.value}</div>
          <div
            className="w-full bg-primary/80 hover:bg-primary rounded-t transition-colors"
            style={{ height: `${(d.value / max) * 100}%`, minHeight: 2 }}
            title={`${d.label}: ${d.value}`}
          />
          <div className="text-[10px] text-muted-foreground truncate w-full text-center">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function RankCard({ title, icon: Icon, items, emptyText }: { title: string; icon: any; items: { label: string; value: number }[]; emptyText: string }) {
  const top = items.slice(0, 8);
  const max = Math.max(...top.map((i) => i.value), 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{emptyText}</p>
        ) : (
          <ul className="space-y-2">
            {top.map((i) => (
              <li key={i.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2">{i.label}</span>
                  <Badge variant="outline" className="tabular-nums">{i.value}</Badge>
                </div>
                <div className="h-1.5 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${(i.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
