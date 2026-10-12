import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SingleRecalcDetail } from "@/ravarer/pages/reberegn/SingleRecalcDetail";
import { parseSingleRecalcPreview, type SinglePreview } from "@/ravarer/lib/singleRecalcPreview";
import type { PreviewState, PreviewTarget } from "@/ravarer/hooks/useSingleRecalcPreview";

/**
 * SKRIVEBESKYTTET DEMONSTRASJON — syntetiske data. Viser den faktiske SingleRecalcDetail med svar som går gjennom
 * den faktiske strenge parseren. Ingen nettverk, ingen hooks mot serveren, ingen tilgangsomgåelse og ingen skrivehandlinger.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Record<string, unknown>) => ({
  line_id: id(n), invoice_date: "2026-09-15", invoice_number: `DEMO-${n}`, description: "Demolinje", quantity: 2, unit: "sekk",
  total_amount: 100, old_ppb: 3, new_ppb: 2.5, applies: true, preview_reason: null, new_base_qty: 40, method: "pakning",
  factor: 20, factor_source: "linje_bekreftet", locked: false, ...over,
});
const changes = [
  line(1, { description: "Hvetemel siktet spesial 20 kg sekk (demo)" }),
  line(2, { description: "Kreditert hvetemel 20 kg (demo)", quantity: -2, total_amount: -100, new_base_qty: -40, factor_source: "variant_varenr" }),
  line(3, { description: "Hvetemel løsvekt i gram (demo)", quantity: 1000, unit: "g", total_amount: 10, new_base_qty: 1, new_ppb: 10, old_ppb: 10, method: "direkte", factor_source: "ravare" }),
  line(4, { description: "Ført linje, låst (demo)", old_ppb: 7, new_ppb: 7, locked: true, applies: false, factor_source: "leverandor" }),
  line(5, { description: "Prøvepose med svært liten mengde (demo)", quantity: 0.0000001, unit: "g", total_amount: 1, new_base_qty: 0, new_ppb: 10000000, method: "direkte", applies: false, preview_reason: "Pakning ikke bekreftet", factor_source: "linje_ulest" }),
  line(6, { description: "Ukjent enhet «kartong» uten pakning (demo)", unit: "kartong", new_base_qty: null, new_ppb: null, method: "ukjent_enhet", factor: null, factor_source: null, applies: null }),
  line(7, { description: "Langt varenavn: Økologisk steinmalt sammalt spelt med særlig høy proteinandel, pakket i papirsekk med plastforing (demo)", total_amount: null, new_ppb: null }),
];
const envelope = {
  ok: true, dry_run: true, recalc_id: null, raw_material: "Økologisk steinmalt hvetemel, siktet type 00 med lang demonstrasjonstittel",
  base_unit: "kg", factor: 20, factor_source: "linje_bekreftet",
  lines_total: changes.length, lines_changed: 3, lines_unknown: 1, lines_outlier: 0, lines_locked: 1, lines_preview_only: 2, lines_excluded: 1,
  manual_cost_protected: false, ppb_median: 2.5, cost_before: 3, cost_after: 2.5, changes,
};
const parsed = parseSingleRecalcPreview(envelope);
const preview: SinglePreview | null = parsed.kind === "ok" ? parsed.preview : null;
const target: PreviewTarget = { rawMaterialId: id(99), name: envelope.raw_material, baseUnit: "kg", origin: "forslag" };

export default function RegnestykkePreviewContent() {
  const [state, setState] = useState<PreviewState>({ status: "closed" });
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-semibold">Demonstrasjon – syntetiske data</p>
      <h1 className="text-xl font-semibold text-ink-primary">Serverens regnestykke (forhåndsvisning)</h1>
      <p className="text-sm text-ink-secondary">Ingen henting eller lagring. Knappene åpner den faktiske detaljvisningen med oppdiktede tall.</p>
      {!preview && <p role="alert">Demodataene ble avvist av parseren.</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-[44px] min-w-[44px]" disabled={!preview} onClick={() => preview && setState({ status: "ok", target, preview })}>Åpne regnestykket</Button>
        <Button variant="outline" className="min-h-[44px] min-w-[44px]" onClick={() => setState({ status: "unavailable", target, reason: "transport" })}>Vis utilgjengelig</Button>
        <Button variant="outline" className="min-h-[44px] min-w-[44px]" onClick={() => setState({ status: "changed", target })}>Vis endrede data</Button>
      </div>
      <SingleRecalcDetail state={state} onClose={() => setState({ status: "closed" })} onRetry={() => undefined} />
    </main>
  );
}
