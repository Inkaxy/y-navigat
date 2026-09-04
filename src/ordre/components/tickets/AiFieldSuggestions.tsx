import { Sparkles } from "lucide-react";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import {
  CONFIDENCE_SHORT,
  CONFIDENCE_TOKEN,
  confidenceLevel,
  type FieldSuggestion,
} from "@/ordre/lib/aiConfidence";
import type { AiSuggestion } from "@/ordre/lib/aiSuggestion";

/** Norske etiketter for feltene AI kan foreslå på en henvendelse. */
const FIELD_LABEL: Record<string, string> = {
  delivery_date: "Hentedato",
  delivery_time: "Hentetid",
  pickup_location_hint: "Hentested",
  delivery_address_line1: "Adresse",
  delivery_address_line2: "Adresse 2",
  delivery_postal_code: "Postnummer",
  delivery_city: "Sted",
  customer_notes: "Kundenotat",
  internal_notes: "Internt notat",
  production_notes: "Produksjonsnotat",
  store_notes: "Butikknotat",
  cake_text: "Kaketekst",
  allergies: "Allergier",
  special_requests: "Spesialønsker",
  contact_phone: "Telefon",
  contact_email: "E-post",
};

/**
 * Gjør AI-forslaget om til feltvise forslag med belegg og sikkerhetsnivå.
 * Eksportert for testbarhet.
 */
export function buildFieldSuggestions(ai: AiSuggestion | null): FieldSuggestion[] {
  if (!ai) return [];
  const out: FieldSuggestion[] = [];
  const fields = ai.order_fields ?? {};
  for (const [field, raw] of Object.entries(fields)) {
    if (raw == null || String(raw).trim() === "") continue;
    const level =
      confidenceLevel(ai.field_confidence?.[field] ?? ai.confidence_score) ?? "low";
    out.push({
      field,
      label: FIELD_LABEL[field] ?? field,
      value: String(raw),
      level,
      evidence: ai.reasoning_per_field?.[field] ?? null,
    });
  }
  for (const p of ai.products ?? []) {
    if (!p.product_name) continue;
    out.push({
      field: `product:${p.product_name}`,
      label: "Produkt",
      value: `${p.quantity} × ${p.product_name}`,
      level: confidenceLevel(p.match_confidence) ?? "low",
      evidence: [p.size_or_servings, p.flavor, p.filling, p.decoration]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }
  return out;
}

/**
 * AI som feltvise forslag — aldri én global prosent som hovedsignal.
 * Hvert forslag viser hva AI leste ut, hvor sikkert det er og hvorfor.
 */
export default function AiFieldSuggestions({
  ai,
  max = 8,
}: {
  ai: AiSuggestion | null;
  max?: number;
}) {
  const suggestions = buildFieldSuggestions(ai).slice(0, max);

  if (suggestions.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        AI har ikke funnet konkrete opplysninger i denne henvendelsen.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5" aria-label="AI-forslag per felt">
      {suggestions.map((s) => (
        <li
          key={s.field}
          className="rounded-[10px] border border-border bg-background px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-caption uppercase tracking-wide text-muted-foreground">
                {s.label}
              </div>
              <div className="break-words text-sm font-medium text-foreground">{s.value}</div>
            </div>
            <StatusPill
              label={CONFIDENCE_SHORT[s.level]}
              tokenVar={CONFIDENCE_TOKEN[s.level]}
              hideDot
              className="shrink-0"
            />
          </div>
          {s.evidence && (
            <p className="mt-1 flex gap-1.5 text-caption text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{s.evidence}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
