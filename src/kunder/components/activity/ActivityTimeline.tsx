import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActivityItem } from "@/kunder/hooks/useCustomerActivityFeed";
import { dayKey, formatActivity, formatDayHeader, formatTime } from "@/kunder/lib/activityFormatters";

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  positive: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-primary/10 text-primary border-primary/20",
};

interface Props {
  items: ActivityItem[];
  isLoading?: boolean;
  showCustomerLink?: boolean;
  emptyText?: string;
}

export function ActivityTimeline({ items, isLoading, showCustomerLink = true, emptyText = "Ingen aktivitet i valgt periode." }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of items) {
      const k = dayKey(it.occurred_at);
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Henter aktivitet…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">{emptyText}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([key, dayItems]) => (
        <div key={key}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {formatDayHeader(dayItems[0].occurred_at)}
          </h3>
          <ol className="space-y-2">
            {dayItems.map((item) => (
              <ActivityRow key={item.id} item={item} showCustomerLink={showCustomerLink} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function ActivityRow({ item, showCustomerLink }: { item: ActivityItem; showCustomerLink: boolean }) {
  const [open, setOpen] = useState(false);
  const visual = formatActivity(item);
  const Icon = visual.icon;
  const hasDetails = !!item.changes && Object.keys(item.changes).length > 0;
  const tone = TONE_CLASSES[visual.tone] ?? TONE_CLASSES.neutral;

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm text-foreground">{visual.title}</p>
            <span className="text-xs text-muted-foreground">{formatTime(item.occurred_at)}</span>
            {item.source_app && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {item.source_app}
              </Badge>
            )}
          </div>
          {item.reason && <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {showCustomerLink && item.customer_id && item.customer_name && (
              <Link to={`/kunder/kundeliste/${item.customer_id}`} className="text-primary hover:underline">
                {item.customer_name}
              </Link>
            )}
            {item.href && item.kind !== "audit" && (
              <Link to={item.href} className="text-primary hover:underline">
                Åpne
              </Link>
            )}
          </div>
          {hasDetails && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
              {open ? "Skjul detaljer" : "Vis detaljer"}
            </Button>
          )}
          {open && hasDetails && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
              {JSON.stringify(item.changes, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
