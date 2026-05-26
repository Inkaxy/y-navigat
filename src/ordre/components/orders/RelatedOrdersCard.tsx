import { useNavigate } from "react-router-dom";
import { Link2, ExternalLink, X, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import type { CandidateOrder, ReferencedOrder } from "@/ordre/lib/aiSuggestion";

interface Props {
  candidates: CandidateOrder[];
  referencedOrderId?: string | null;
  linkedOrderId: string | null;
  onLink: (orderId: string) => void;
  onUnlink: () => void;
  busy?: boolean;
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function confBadge(n: number | null | undefined) {
  if (n == null) return "bg-muted text-muted-foreground border-border";
  if (n >= 0.8) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (n >= 0.5) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "d. MMM yyyy", { locale: nb }); } catch { return d; }
}

export function RelatedOrdersCard({ candidates, referencedOrderId, linkedOrderId, onLink, onUnlink, busy }: Props) {
  const navigate = useNavigate();
  if (!linkedOrderId && candidates.length === 0) return null;

  // Sorter slik at referenced_order kommer først, deretter etter confidence
  const sorted = [...candidates].sort((a, b) => {
    if (a.order_id === referencedOrderId) return -1;
    if (b.order_id === referencedOrderId) return 1;
    return b.match_confidence - a.match_confidence;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          {linkedOrderId ? "Koblet ordre" : "Foreslåtte ordre å koble til"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {linkedOrderId && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="text-sm font-medium truncate">Ticket er koblet til ordre</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => navigate(`/ordre/ordrer/${linkedOrderId}`)}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Vis
              </Button>
              <Button size="sm" variant="ghost" onClick={onUnlink} disabled={busy} title="Fjern kobling">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        {!linkedOrderId && sorted.map((c, idx) => (
          <div
            key={c.order_id}
            className={cn(
              "rounded-md border p-2.5 text-sm space-y-1.5",
              idx === 0 && "border-primary/40 bg-primary/5",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{c.order_number ?? c.order_id.slice(0, 8)}</span>
                  {c.snapshot?.status && (
                    <Badge variant="outline" className="text-[10px] capitalize">{c.snapshot.status}</Badge>
                  )}
                  <Badge variant="outline" className={cn("text-[10px]", confBadge(c.match_confidence))}>
                    {pct(c.match_confidence)}
                  </Badge>
                  {idx === 0 && c.order_id === referencedOrderId && (
                    <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">Mest sannsynlig</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Henting: {fmtDate(c.snapshot?.delivery_date)}
                  {c.snapshot?.delivery_time ? ` · ${c.snapshot.delivery_time.slice(0, 5)}` : ""}
                  {c.snapshot?.customer_name ? ` · ${c.snapshot.customer_name}` : ""}
                </div>
                {c.snapshot?.line_summary && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{c.snapshot.line_summary}</div>
                )}
                {c.why_match && <div className="text-xs italic text-muted-foreground mt-1">{c.why_match}</div>}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button size="sm" onClick={() => onLink(c.order_id)} disabled={busy}>
                  Koble til
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/ordre/ordrer/${c.order_id}`)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
