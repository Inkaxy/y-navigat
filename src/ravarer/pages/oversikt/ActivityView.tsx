import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNowStrict } from "date-fns";
import { nb } from "date-fns/locale";
import { paths } from "@/ravarer/lib/paths";
import { ACTIVITY_KIND_LABELS, labelFor, toneStyle } from "@/ravarer/lib/labels";
import type { ActivityFeed, ActivityItem } from "@/ravarer/lib/workRpcTypes";

export type ActivityViewProps = { data: ActivityFeed | null; loading?: boolean };

function summaryLine(s: Record<string, number>): string {
  const parts: string[] = [];
  const add = (n: number | undefined, singular: string, plural: string) => {
    if (!n) return;
    parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  add(s.faktura_avstemt_auto, "faktura avstemt automatisk", "fakturaer avstemt automatisk");
  add(s.pakning_bekreftet_auto, "pakning bekreftet", "pakninger bekreftet");
  add(s.forste_pris, "første pris", "første priser");
  add(s.gjentatt_pris, "prisendring bekreftet", "prisendringer bekreftet av gjentatte fakturaer");
  return parts.length ? `Siste 7 dager: ${parts.join(" · ")}` : "Ingen automatiske hendelser siste 7 dager.";
}

function subjectHref(it: ActivityItem): string | null {
  if (it.invoice_id) return paths.faktura(it.invoice_id);
  if (it.raw_material_id) return paths.raavare(it.raw_material_id);
  return null;
}

export function ActivityView({ data, loading }: ActivityViewProps) {
  const [expanded, setExpanded] = useState(false);
  const items = data?.items ?? [];
  const visible = expanded ? items.slice(0, 25) : items.slice(0, 8);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-display text-xl">Skjedde automatisk</h2>
        <p className="mt-1 text-caption text-ink-secondary">
          {data ? summaryLine(data.summary) : "Laster …"}
        </p>
      </div>

      {loading && (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="p-5 text-sm text-ink-secondary">Ingenting å vise ennå.</p>
      )}

      {!loading && items.length > 0 && (
        <ul className="divide-y divide-border">
          {visible.map((it) => {
            const meta = labelFor(ACTIVITY_KIND_LABELS, it.kind, "Hendelse");
            const href = subjectHref(it);
            const when = formatDistanceToNowStrict(new Date(it.at), { addSuffix: true, locale: nb });
            return (
              <li key={it.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <span
                  aria-hidden
                  className="shrink-0 rounded-full px-2 py-0.5 text-caption font-medium"
                  style={toneStyle(meta.tokenVar)}
                >
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{it.title}</div>
                  {it.subject && (
                    <div className="truncate text-caption text-ink-secondary">
                      {href ? <Link to={href} className="hover:underline">{it.subject}</Link> : it.subject}
                    </div>
                  )}
                  {it.detail && (
                    <div className="line-clamp-2 text-caption text-ink-secondary" title={it.detail}>{it.detail}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-caption text-ink-secondary">
                  <div>{when}</div>
                  <div>{it.actor === "system" ? "System" : it.user_name ?? "Bruker"}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 8 && (
        <div className="border-t border-border px-5 py-2 text-right">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Vis færre" : "Vis flere"}
          </Button>
        </div>
      )}
    </Card>
  );
}
