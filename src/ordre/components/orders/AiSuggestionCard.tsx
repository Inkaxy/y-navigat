import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Loader2, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, PlusCircle, Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  REQUEST_TYPE_LABEL, REQUEST_TYPE_BADGE, RISK_STYLE,
  normalizeAiSuggestion, type AiSuggestion,
} from "@/ordre/lib/aiSuggestion";

interface Props {
  ticketId: string;
  ticketStatus: string;
  hasOrder: boolean;
  relatedOrderId: string | null;
  analyzedAt: string | null;
  suggestion: unknown;
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

function confBadge(n: number | null | undefined) {
  if (n == null) return "bg-muted text-muted-foreground border-border";
  if (n >= 0.8) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (n >= 0.5) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

function ConfDot({ n }: { n: number | undefined | null }) {
  if (n == null) return null;
  const cls = n >= 0.8 ? "bg-emerald-500" : n >= 0.5 ? "bg-amber-500" : "bg-rose-500";
  return <span title={`Confidence ${pct(n)}`} className={cn("inline-block h-2 w-2 rounded-full", cls)} />;
}

const ORDER_FIELD_LABEL: Record<string, string> = {
  delivery_date: "Hentedato",
  delivery_time: "Hentetid",
  pickup_location_hint: "Hentested",
  delivery_address_line1: "Adresse",
  delivery_address_line2: "Adresse 2",
  delivery_postal_code: "Postnr",
  delivery_city: "By",
  customer_notes: "Kundenotat",
  internal_notes: "Internt notat",
  production_notes: "Produksjonsnotat",
  cake_text: "Kaketekst",
  allergies: "Allergier",
  special_requests: "Spesialønsker",
  contact_phone: "Telefon",
  contact_email: "Epost",
};

export function AiSuggestionCard(props: Props) {
  const {
    ticketId, ticketStatus, hasOrder, relatedOrderId,
    analyzedAt, suggestion: rawSuggestion, provider, model, costUsd, error, confidence,
  } = props;
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const suggestion: AiSuggestion | null = normalizeAiSuggestion(rawSuggestion);
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

  const orderFieldsEntries = suggestion
    ? Object.entries(suggestion.order_fields ?? {}).filter(([, v]) => v != null && v !== "")
    : [];

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AI-arbeidspanel
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {suggestion && (
              <Badge variant="outline" className={cn("text-xs", REQUEST_TYPE_BADGE[suggestion.request_type])}>
                {REQUEST_TYPE_LABEL[suggestion.request_type]}
              </Badge>
            )}
            {confidence != null && (
              <Badge variant="outline" className={cn("text-xs", confBadge(confidence))}>
                {pct(confidence)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tomtilstand */}
        {!analyzedAt && !loading && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Ikke analysert ennå. Kjør AI-analyse for å få sammendrag, foreslåtte ordrefelt og mangler.
            </p>
            {canAnalyze && (
              <Button size="sm" onClick={() => runAnalyze(false)} disabled={loading}>
                <Sparkles className="mr-2 h-4 w-4" /> Analyser med AI
              </Button>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyserer …
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">Forrige analyse feilet</div>
              <div className="text-xs mt-1 text-muted-foreground">{error}</div>
            </div>
          </div>
        )}

        {suggestion && (
          <>
            {/* Sammendrag */}
            {suggestion.summary && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Sammendrag</div>
                <p className="text-sm leading-relaxed">{suggestion.summary}</p>
              </div>
            )}

            {/* Foreslått handling + primær CTA */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Foreslått handling</div>
              {suggestion.suggested_action && (
                <p className="text-sm">{suggestion.suggested_action}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {relatedOrderId ? (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/ordre/ordrer/${relatedOrderId}`)}>
                    <Link2 className="mr-2 h-4 w-4" /> Vis tilknyttet ordre
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate(`/ordre/ordrer/ny?ticket_id=${ticketId}`)}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Opprett ordre fra forslag
                  </Button>
                )}
              </div>
            </div>

            {/* Kunde */}
            <div className="grid grid-cols-1 gap-2 text-sm">
              <Field label="Kunde">
                {suggestion.customer_match?.customer_name ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{suggestion.customer_match.customer_name}</span>
                    {suggestion.customer_match.customer_id ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Ikke matchet</Badge>
                    )}
                    <Badge variant="outline" className={cn("text-[10px]", confBadge(suggestion.customer_match.match_confidence))}>
                      {pct(suggestion.customer_match.match_confidence)}
                    </Badge>
                  </div>
                ) : <span className="text-muted-foreground">Ingen match — velges manuelt</span>}
              </Field>
            </div>

            {/* Mangler */}
            {suggestion.missing_info.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Mangler ({suggestion.missing_info.length})
                </div>
                <ul className="space-y-1">
                  {suggestion.missing_info.map((m) => (
                    <li key={m.code} className="text-sm flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {m.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risiko */}
            {suggestion.risks.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                  Risiko / sjekkpunkter
                </div>
                <ul className="space-y-1.5">
                  {suggestion.risks.map((r, i) => (
                    <li key={i} className={cn("text-xs rounded-md border px-2 py-1.5", RISK_STYLE[r.severity])}>
                      {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Foreslåtte ordrefelt */}
            {orderFieldsEntries.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">Foreslåtte ordrefelt</div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                  {orderFieldsEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground flex items-center gap-1.5">
                        <ConfDot n={suggestion.field_confidence?.[k]} />
                        {ORDER_FIELD_LABEL[k] ?? k}
                      </dt>
                      <dd className="break-words">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Produkter */}
            {suggestion.products.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                  Foreslåtte varer ({suggestion.products.length})
                </div>
                <ul className="border rounded-md divide-y">
                  {suggestion.products.map((p, i) => (
                    <li key={i} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium">{p.product_name}</span>
                          {p.product_id && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="tabular-nums">{p.quantity} stk</span>
                          <Badge variant="outline" className={cn("text-[10px]", confBadge(p.match_confidence))}>
                            {pct(p.match_confidence)}
                          </Badge>
                        </div>
                      </div>
                      {(p.size_or_servings || p.flavor || p.filling || p.decoration) && (
                        <div className="mt-1 text-xs text-muted-foreground space-x-2">
                          {p.size_or_servings && <span>{p.size_or_servings}</span>}
                          {p.flavor && <span>· {p.flavor}</span>}
                          {p.filling && <span>· Fyll: {p.filling}</span>}
                          {p.decoration && <span>· {p.decoration}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Begrunnelse */}
            {suggestion.reasoning && (
              <details className="rounded-md border bg-muted/30 p-2 text-xs">
                <summary className="cursor-pointer font-medium">AI-resonnement</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{suggestion.reasoning}</p>
                {Object.keys(suggestion.reasoning_per_field ?? {}).length > 0 && (
                  <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
                    {Object.entries(suggestion.reasoning_per_field).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{ORDER_FIELD_LABEL[k] ?? k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </details>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground border-t pt-2">
              <span>
                {provider} / {model}
                {costUsd != null && ` · $${costUsd.toFixed(4)}`}
              </span>
              {canAnalyze && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => runAnalyze(true)} disabled={loading}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Analyser på nytt
                </Button>
              )}
            </div>
          </>
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
