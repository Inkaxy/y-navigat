import { useState } from "react";
import { DatasheetReviewView, type ReviewCurrent, type ReviewTarget } from "@/ravarer/components/datablad/DatasheetReviewDialog";

/**
 * SKRIVEBESKYTTET FORHÅNDSVISNING — oppdiktede eksempelverdier, ingen nettverk, ingen opplasting, AI eller anvendelse.
 * Viser den faktiske gjennomgangsvisningen (før/etter, næringsvalg, koblede E-numre/opprinnelsesland).
 */
const target: ReviewTarget = {
  key: "preview",
  fileName: "Eksempel – produktdatablad hvetemel.pdf",
  storagePath: null,
  rmId: "preview-rm",
  targetName: "Eksempel: Hvetemel siktet 25 kg",
  ai: {
    nutrition: { energy_kj: 1450, energy_kcal: 343, fat_g: 1.6, saturated_fat_g: 0.3, carbs_g: 69, sugars_g: 1.2, fiber_g: 3.4, protein_g: 11.5, salt_g: 0.01 },
    e_numbers: ["E300"],
    country_of_origin: "Norge",
    allergens: [{ allergen: "gluten_wheat", presence: "contains" }, { allergen: "soy", presence: "may_contain" }],
    ingredient_declaration: "HVETEMEL, askorbinsyre (E300)",
    grain_classification_hint: "fint",
  },
};
const current: ReviewCurrent = {
  nutrition: { energy_kj: 1420, energy_kcal: 336, fat_g: 1.4, saturated_fat_g: 0.3, carbs_g: 70, sugars_g: 1.0, fiber_g: 3.0, protein_g: 11.0, salt_g: 0.01, ingredient_declaration: "HVETEMEL", e_numbers: null, country_of_origin: null },
  allergens: [{ allergen: "gluten_wheat", presence: "contains" }],
  grain: null,
};

export default function DatasheetReviewPreviewContent() {
  const [last, setLast] = useState<string>("Ingen handling ennå.");
  const [open, setOpen] = useState(true);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 md:p-6">
      <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        Forhåndsvisning med oppdiktede eksempelverdier. Ingenting lagres, lastes opp eller sendes — knappene viser bare hva som ville blitt sendt.
      </p>
      <p className="text-sm text-ink-secondary" data-testid="preview-last">{last}</p>
      {!open && <button type="button" className="min-h-[44px] rounded-md border border-border px-3 text-sm" onClick={() => setOpen(true)}>Åpne gjennomgangen igjen</button>}
      <DatasheetReviewView
        target={open ? target : null}
        canWrite
        busy={false}
        current={current}
        loading={false}
        failed={false}
        onOpenDocument={() => setLast("Originalen åpnes ikke i forhåndsvisningen.")}
        onClose={() => setOpen(false)}
        onConfirm={(fields, nut, mode) => setLast(`Ville sendt (${mode === "apply" ? "anvend" : "merk"}): felt ${fields.join(", ") || "—"}; næringsfelt ${nut.join(", ") || "—"}.`)}
      />
    </div>
  );
}
