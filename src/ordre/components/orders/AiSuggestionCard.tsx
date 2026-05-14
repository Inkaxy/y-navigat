import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface AiSuggestion {
  customer_match: { customer_id: string | null; customer_name: string | null; match_confidence: number } | null;
  products: Array<{ product_id: string | null; product_name: string; quantity: number; match_confidence: number }>;
  delivery_date: string | null;
  tour: { tour_id: string | null; tour_name: string | null } | null;
  confidence_score: number;
  reasoning: string;
}

interface Props {
  ticketId: string;
  ticketStatus: string;
  hasOrder: boolean;
  analyzedAt: string | null;
  suggestion: AiSuggestion | null;
  provider: string | null;
  model: string | null;
  costUsd: number | null;
  error: string | null;
  confidence: number | null;
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function confColor(n: number | null | undefined) {
  if (n == null) return "bg-muted text-muted-foreground";
  if (n >= 0.8) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (n >= 0.5) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-rose-100 text-rose-800 border-rose-300";
}

export function AiSuggestionCard(props: Props) {
  const { ticketId, ticketStatus, hasOrder, analyzedAt, suggestion, provider, model, costUsd, error, confidence } = props;
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const canAnalyze = !hasOrder && (ticketStatus === "new" || ticketStatus === "in_progress");

  const runAnalyze = async (force = false) => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.functions.invoke("analyze-email-with-ai", {
        body: { ticket_id: ticketId, force },
      });
      if (e) throw e;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: force ? "Re-analyse fullført" : "AI-analyse fullført" });
      await qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      toast({ title: "AI-analyse feilet", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AI-analyse
            {confidence != null && (
              <Badge className={confColor(confidence)} variant="outline">
                Confidence: {pct(confidence)}
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {!analyzedAt && canAnalyze && (
              <Button size="sm" onClick={() => runAnalyze(false)} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Analyser med AI
              </Button>
            )}
            {analyzedAt && canAnalyze && (
              <Button size="sm" variant="outline" onClick={() => runAnalyze(true)} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Analyser på nytt
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!analyzedAt && !loading && (
          <p className="text-sm text-muted-foreground">
            Ikke analysert ennå. Klikk «Analyser med AI» for å få et strukturert ordre-forslag fra e-posten.
          </p>
        )}

        {error && (
          <div className="flex gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Forrige analyse feilet</div>
              <div className="text-xs mt-1">{error}</div>
            </div>
          </div>
        )}

        {suggestion && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Kunde">
                {suggestion.customer_match?.customer_name ? (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{suggestion.customer_match.customer_name}</span>
                    <Badge variant="outline" className={confColor(suggestion.customer_match.match_confidence)}>
                      {pct(suggestion.customer_match.match_confidence)}
                    </Badge>
                    {suggestion.customer_match.customer_id && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                  </div>
                ) : <span className="text-muted-foreground">Ingen match</span>}
              </Field>
              <Field label="Leveringsdato">
                {suggestion.delivery_date ?? <span className="text-muted-foreground">—</span>}
              </Field>
              <Field label="Tur">
                {suggestion.tour?.tour_name ?? <span className="text-muted-foreground">—</span>}
              </Field>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Foreslåtte varer ({suggestion.products.length})</div>
              {suggestion.products.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Ingen varer foreslått</p>
              ) : (
                <ul className="border rounded-md divide-y">
                  {suggestion.products.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{p.product_name}</span>
                        {p.product_id && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums font-medium">{p.quantity} stk</span>
                        <Badge variant="outline" className={confColor(p.match_confidence)}>
                          {pct(p.match_confidence)}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {suggestion.reasoning && (
              <details className="rounded-md border bg-muted/30 p-2 text-xs">
                <summary className="cursor-pointer font-medium">AI-resonnement</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{suggestion.reasoning}</p>
              </details>
            )}

            <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
              <span>
                {provider} / {model}
                {costUsd != null && ` · $${costUsd.toFixed(4)}`}
              </span>
              {analyzedAt && <span>Analysert {new Date(analyzedAt).toLocaleString("nb-NO")}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
