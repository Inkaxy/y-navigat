// Viser deterministiske regelvarsler basert på AI-forslag + faktiske
// åpningstider, frister, lead-times og kapasitet. Komplementerer AI's egne
// risikovurderinger med konkrete, forklarte sjekker mot DB-regler.
import { useMemo } from "react";
import { AlertTriangle, Info, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrderRulesContext } from "@/ordre/hooks/useOrderRulesContext";
import {
  evaluateRules,
  summarizeRuleSeverity,
  type RuleCheck,
  type RuleSeverity,
} from "@/ordre/lib/orderRules";
import { normalizeAiSuggestion } from "@/ordre/lib/aiSuggestion";

const ICONS: Record<RuleSeverity, JSX.Element> = {
  red: <ShieldAlert className="h-4 w-4 text-destructive" />,
  yellow: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  info: <Info className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
};

const BORDER: Record<RuleSeverity, string> = {
  red: "border-destructive/30 bg-destructive/5",
  yellow: "border-amber-500/30 bg-amber-500/5",
  info: "border-sky-500/30 bg-sky-500/5",
};

const SUMMARY_LABEL: Record<RuleSeverity, string> = {
  red: "Blokkerende",
  yellow: "Krever sjekk",
  info: "Til info",
};

export function RuleWarningsCard({ aiSuggestion }: { aiSuggestion: unknown }) {
  const suggestion = useMemo(() => normalizeAiSuggestion(aiSuggestion), [aiSuggestion]);

  const productIds = useMemo(
    () => (suggestion?.products ?? []).map((p) => p.product_id).filter((x): x is string => !!x),
    [suggestion],
  );

  const { data: ctx, isLoading } = useOrderRulesContext(productIds);

  const checks: RuleCheck[] = useMemo(() => {
    if (!suggestion || !ctx) return [];
    const totalQty = (suggestion.products ?? []).reduce(
      (sum, p) => sum + (Number(p.quantity) || 0),
      0,
    );
    return evaluateRules({
      delivery_date: suggestion.order_fields?.delivery_date ?? null,
      delivery_time: suggestion.order_fields?.delivery_time ?? null,
      pickup_location_hint: suggestion.order_fields?.pickup_location_hint ?? null,
      product_ids: productIds,
      allergies: suggestion.order_fields?.allergies ?? null,
      total_quantity: totalQty || null,
      outlets: ctx.outlets,
      outlet_exceptions: ctx.outlet_exceptions,
      products: ctx.products,
      delivery_rules: ctx.delivery_rules,
    });
  }, [suggestion, ctx, productIds]);

  if (!suggestion) return null;

  const sev = summarizeRuleSeverity(checks);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Regelsjekk
          {sev && (
            <Badge variant="outline" className={`ml-auto text-[10px] ${BORDER[sev]}`}>
              {SUMMARY_LABEL[sev]} ({checks.length})
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : checks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ingen regelbrudd funnet basert på åpningstider, frister og produkt-lead-time.
          </p>
        ) : (
          <ul className="space-y-2">
            {checks.map((c) => (
              <li
                key={c.id}
                className={`flex gap-2 rounded-md border p-2 text-xs ${BORDER[c.severity]}`}
              >
                <span className="mt-0.5 shrink-0">{ICONS[c.severity]}</span>
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground">{c.title}</div>
                  {c.detail && <div className="text-muted-foreground">{c.detail}</div>}
                  {c.suggestion && (
                    <div className="text-foreground/90">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                        Forslag:
                      </span>
                      {c.suggestion}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default RuleWarningsCard;
