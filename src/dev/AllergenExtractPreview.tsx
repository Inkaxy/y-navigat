import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Textarea } from "@/components/ui/textarea";
import { DeclarationAllergenExtractor } from "@/varer/components/declaration/DeclarationAllergenExtractor";
import { sourceFingerprint } from "@/varer/lib/declarationProposal";
import type { AllergenApplyPlan } from "@/varer/lib/declarationAllergenSuggestion";
import "@/index.css";

/**
 * Kun utvikling: viser «Hent allergener fra deklarasjon» med en fast mock-respons.
 * Ingen innlogging, ingen serverkall, ingen produktdata.
 */
const TEXT = "vann, speltmel, havregryn, solsikkekjerner, linfrø, sammalt spelt, valnøtter, salt, gjær, brunt sukker";

function mockInvoke(body: Record<string, unknown>) {
  const text = String(body.draft_text ?? "");
  return Promise.resolve({
    data: {
      mode: "allergens",
      source_fingerprint: sourceFingerprint(text),
      extraction: {
        contains: [
          { code: "gluten_wheat", label: "hvete", evidence: "speltmel" },
          { code: "gluten_oats", label: "havre", evidence: "havregryn" },
          { code: "nuts_walnut", label: "valnøtter", evidence: "valnøtter" },
        ],
        mayContain: [],
        traceStatement: { stated: false, evidence: null },
        uncertainties: [],
        rejected: [],
      },
    },
    error: null,
  });
}

function Preview() {
  const [text, setText] = useState(TEXT);
  const [fields, setFields] = useState({ contains: "egg", mayContain: "sesamfrø" });
  const [last, setLast] = useState<AllergenApplyPlan | null>(null);
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-6">
      <Textarea aria-label="Ingrediensdeklarasjon" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      <DeclarationAllergenExtractor
        target="recipe"
        targetId="00000000-0000-0000-0000-000000000001"
        value={text}
        canWrite
        current={fields}
        invoke={mockInvoke}
        onApply={(p) => {
          setLast(p);
          setFields(p.next);
        }}
      />
      <p className="text-sm">Inneholder: {fields.contains || "–"} · Spor: {fields.mayContain || "–"}</p>
      {last && <p className="text-xs text-muted-foreground">Bekreftelse kreves i appen: {last.needsConfirm ? "ja" : "nei"}</p>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
