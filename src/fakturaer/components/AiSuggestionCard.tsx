import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { itemTypeLabel } from "@/ravarer/lib/itemTypes";
import { isFromOriginal, LINE_CLASS_LABELS, PRICE_BASIS_LABELS, type AiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import type { CreatePrefill } from "@/ravarer/editors/createSheetLogic";

/** Navnet på foreslått råvare (RLS avgjør synlighet). */
export function useRawMaterialName(id: string | null) {
  return useQuery({
    queryKey: ["ai-suggestion-rm", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw new Error("Kunne ikke hente råvaren");
      return data?.name ?? null;
    },
  });
}

export function draftToPrefill(s: AiLineSuggestion): CreatePrefill | null {
  if (!s.draft) return null;
  return {
    name: s.draft.name,
    itemType: s.draft.itemType,
    category: s.draft.category,
    ...(s.draft.baseUnit ? { baseUnit: s.draft.baseUnit } : {}),
  };
}

const fmt = (n: number) => String(n).replace(".", ",");

interface Props {
  suggestion: AiLineSuggestion;
  /** Navn på foreslått eksisterende vare; null = ikke hentet/ukjent. */
  rawMaterialName: string | null;
  canWrite: boolean;
  onApply?: () => void;
  onCreateDraft?: (prefill: CreatePrefill) => void;
  onNotItem?: () => void;
  /** Melding etter «Bruk forslag», f.eks. hvilke felt som ble beholdt. */
  appliedNote?: string | null;
}

/**
 * Viser et AI-forslag: hva som er lest fra fakturaen, hva som er foreslått, hva som
 * mangler, og konkrete neste handlinger. Lagrer ingenting selv.
 */
export function AiSuggestionCard({ suggestion: s, rawMaterialName, canWrite, onApply, onCreateDraft, onNotItem, appliedNote }: Props) {
  const read = s.evidence.filter((e) => e.source === "faktura");
  const known = s.evidence.filter((e) => e.source === "kjent_vare" || e.source === "korrigering");
  const doubts = [...s.rejected, ...s.uncertainties];
  const prefill = draftToPrefill(s);
  return (
    <section aria-label="AI-forslag" className="space-y-2 rounded-md border border-line-subtle bg-muted/40 p-3 text-sm">
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-ink-secondary" aria-hidden />
        <span className="font-medium">AI-forslag – ikke bekreftet</span>
        <span className="text-caption text-ink-secondary">
          {LINE_CLASS_LABELS[s.lineClass]}
          {s.confidence != null ? ` · modellens egen vurdering ${Math.round(s.confidence * 100)} %` : ""}
          {s.model ? ` · ${s.model}` : ""}
        </span>
      </header>

      <SourceNote s={s} />
      {read.length > 0 && (
        <div>
          <h5 className="text-caption font-semibold">{isFromOriginal(s) ? "Registrert linje" : "Fra registrert linje"}</h5>
          <ul className="text-caption text-ink-secondary">{read.map((e, i) => <li key={i}>{e.field}: {e.value}</li>)}</ul>
        </div>
      )}

      <div>
        <h5 className="text-caption font-semibold">Foreslått</h5>
        <ul className="text-caption">
          {s.decision === "existing" && <li>Eksisterende vare: <strong>{rawMaterialName ?? "…"}</strong></li>}
          {s.decision === "new_draft" && s.draft && (
            <li>
              Ny vare: <strong>{s.draft.name}</strong> · {itemTypeLabel(s.draft.itemType)} · kategori {s.draft.category ?? "ukjent"} ·
              grunnenhet {s.draft.baseUnit ?? "ukjent"} · varenr. {s.draft.supplierSku ?? "ingen på linjen"}
            </li>
          )}
          {s.decision === "not_raw_material" && <li>Ikke en vare ({LINE_CLASS_LABELS[s.lineClass].toLowerCase()}).</li>}
          {s.decision === "unclear" && <li>Ingen sikker vare. Søk fram varen eller opprett ny selv.</li>}
          {(s.decision === "existing" || s.decision === "new_draft") && (
            <li>
              Pakning: {s.packageSize != null ? `${fmt(s.packageSize)} ${s.packageUnit ?? ""}`.trim() : "ukjent"}
              {s.countPerPackage != null ? ` · ${fmt(s.countPerPackage)} per pakning` : ""} · pris {PRICE_BASIS_LABELS[s.priceBasis]}
            </li>
          )}
          {known.map((e, i) => <li key={`k${i}`} className="text-ink-secondary">{e.field}: {e.value} ({e.source === "kjent_vare" ? "kjent vare" : "bekreftet rettelse"})</li>)}
        </ul>
        {s.explanation && <p className="text-caption text-ink-secondary">{s.explanation}</p>}
      </div>

      {s.missing.length > 0 && (
        <div>
          <h5 className="text-caption font-semibold">Mangler</h5>
          <ul className="list-disc pl-4 text-caption text-ink-secondary">{s.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {doubts.length > 0 && (
        <div>
          <h5 className="text-caption font-semibold">Usikkert eller forkastet</h5>
          <ul className="list-disc pl-4 text-caption text-ink-secondary">{doubts.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {canWrite && s.decision === "existing" && s.rawMaterialId && onApply && (
          <Button type="button" size="sm" variant="outline" onClick={onApply}>Bruk forslag i skjemaet</Button>
        )}
        {canWrite && s.decision === "new_draft" && prefill && onCreateDraft && (
          <Button type="button" size="sm" variant="outline" onClick={() => onCreateDraft(prefill)}>Opprett ny vare fra forslaget …</Button>
        )}
        {canWrite && s.decision === "not_raw_material" && onNotItem && (
          <Button type="button" size="sm" variant="outline" onClick={onNotItem}>Ikke vare … (oppgi grunn)</Button>
        )}
      </div>
      {appliedNote && <p className="text-caption" role="status">{appliedNote}</p>}
      <p className="text-caption text-ink-secondary">
        Forslaget lagrer ingenting. Du kontrollerer og bekrefter vare og pakning selv; prisen vurderes separat.
      </p>
    </section>
  );
}

const REASON_TEXT: Record<string, string> = {
  mangler: "fakturaen har ingen lagret original",
  ukjent: "originalen kunne ikke hentes",
  for_stor: "originalen er for stor",
  endret: "originalen ble endret under henting",
};

function SourceNote({ s }: { s: AiLineSuggestion }) {
  if (!isFromOriginal(s)) {
    return (
      <p className="text-caption text-ink-secondary" role="note">
        Forslag basert på registrert linje, original ikke kontrollert{s.originalReason ? ` (${REASON_TEXT[s.originalReason]})` : ""}.
      </p>
    );
  }
  return (
    <div role="note" className="space-y-1">
      <p className="text-caption text-ink-secondary">
        Kontrollert mot originalen{s.sourceStatus === "original_tekst" ? " (tekstlaget i PDF-en)" : " (PDF-en)"}
        {s.originalPage != null ? `, side ${s.originalPage}` : ""}.
      </p>
      {s.originalRow && <p className="text-caption"><span className="font-semibold">Lest fra originalen:</span> {s.originalRow}</p>}
      {s.originalDifferences.length > 0 && (
        <div>
          <h5 className="text-caption font-semibold">Avvik mellom original og registrert linje</h5>
          <ul className="list-disc pl-4 text-caption">{s.originalDifferences.map((d, i) => <li key={i}>{d}</li>)}</ul>
          <p className="text-caption text-ink-secondary">Linjen endres ikke automatisk. Rett den via «Rett fakturalinje».</p>
        </div>
      )}
    </div>
  );
}
