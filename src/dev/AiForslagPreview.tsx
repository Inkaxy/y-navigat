import { useState } from "react";
import { AiSuggestionCard } from "@/fakturaer/components/AiSuggestionCard";
import { EvalResults } from "@/ravarer/pages/innstillinger/ModelEvalCard";
import { parseAiSuggestion, type AiLineSuggestion } from "@/fakturaer/lib/aiLineSuggestion";
import { parseEvalOutcome } from "@/ravarer/lib/modelEval";

/** Syntetisk, nettverksfri forhåndsvisning av AI-forslag og modellsammenligning. Ingenting lagres. */
const CASES: Record<string, AiLineSuggestion> = {
  eksisterende: parseAiSuggestion({
    decision: "existing", raw_material_id: "rm-1", line_class: "vare", confidence: 0.82, package_size: 20, package_unit: "kg",
    count_per_package: null, price_basis: "per_enhet", draft: null,
    evidence: [{ field: "Varenr.", value: "12113", source: "faktura" }, { field: "Tekst", value: "Combisur Soft sekk 20kg", source: "faktura" }, { field: "Bekreftet pakning", value: "20 kg per sekk", source: "kjent_vare" }],
    explanation: "Samme leverandørvarenummer som en kjent vare.", uncertainties: [], missing: [], rejected: [], model: "gpt-4o",
  })!,
  ny: parseAiSuggestion({
    decision: "new_draft", raw_material_id: null, line_class: "vare", confidence: 0.6, package_size: null, package_unit: null,
    count_per_package: null, price_basis: "ukjent",
    draft: { name: "Pistasjpasta", item_type: "ravare", category: "Fyll", base_unit: "kg", supplier_sku: "PAL-4410" },
    evidence: [{ field: "Varenr.", value: "PAL-4410", source: "faktura" }, { field: "Mengde", value: "3.000 kg", source: "faktura" }],
    explanation: "Ingen kandidat i selskapet. Utkast fra linjeteksten.", uncertainties: ["Uklart om prisen gjelder kg eller spann."],
    missing: ["pakningsstørrelse"], rejected: ["Pakningsstørrelse 1 står ikke på linjen; ikke brukt."], model: "gpt-4o",
  })!,
  erstatning: parseAiSuggestion({
    decision: "not_raw_material", raw_material_id: null, line_class: "erstatning", confidence: 0.7, package_size: null, package_unit: null,
    count_per_package: null, price_basis: "ukjent", draft: null,
    evidence: [{ field: "Tekst", value: "Kreditering ødelagt vare", source: "faktura" }],
    explanation: "Kompensasjon, ikke en ordinær vare.", uncertainties: [], missing: [], rejected: ["Linjetypen er ikke en vare; vareforslaget er fjernet."], model: "gpt-4o",
  })!,
};

const EVAL = [
  parseEvalOutcome({ invoice_number: "TEST-1542054", status: "ok", usage: { input_tokens: 5120, output_tokens: 1310, cached_input_tokens: null, reasoning_tokens: null }, estimated_cost_usd: 0.0259, latency_ms: 21400, parsed: { lines: [1, 2, 3] }, checks: [{}, {}], check_counts: { pakning_mangler: 1, sumavvik: 1 }, stored_line_count: 3 }, "x", "gpt-4o"),
  parseEvalOutcome({ invoice_number: "TEST-1542054", status: "ok", usage: { input_tokens: 5080, output_tokens: 2200, cached_input_tokens: 0, reasoning_tokens: 900 }, estimated_cost_usd: null, latency_ms: 34000, parsed: { lines: [1, 2, 3] }, checks: [], check_counts: {}, stored_line_count: 3 }, "x", "gpt-6.1-sol"),
  parseEvalOutcome({ error: { code: "model_unavailable", message: "Modellen finnes ikke for denne nøkkelen" } }, "x", "gpt-6-luna"),
];

export default function AiForslagPreview() {
  const [k, setK] = useState<keyof typeof CASES>("eksisterende");
  const [note, setNote] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-page">
      <p className="text-caption text-ink-secondary">Syntetisk forhåndsvisning – ingen data lagres, ingen AI kalles.</p>
      <div className="flex gap-2 text-sm">
        {(Object.keys(CASES) as (keyof typeof CASES)[]).map((c) => (
          <button key={c} className={`min-h-11 rounded-md border px-3 ${k === c ? "border-primary" : "border-border"}`} onClick={() => { setK(c); setNote(null); }}>{c}</button>
        ))}
      </div>
      <AiSuggestionCard suggestion={CASES[k]} rawMaterialName="Idun Combisur Soft" canWrite appliedNote={note}
        onApply={() => setNote("Forslaget er fylt inn, men ikke bekreftet.")}
        onCreateDraft={(p) => setNote(`Åpner «Ny råvare» med ${p.name} (ikke lagret).`)}
        onNotItem={() => setNote("Åpner «Ikke vare» (ikke lagret).")} />
      <h2 className="text-title">Modellsammenligning (syntetisk)</h2>
      <EvalResults results={EVAL} />
    </main>
  );
}
