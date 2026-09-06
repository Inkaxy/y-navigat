import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileText, Loader2, Sparkles, History, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDatasheets } from "@/ravarer/hooks/useDatasheets";
import { useChangelog } from "@/ravarer/hooks/useDatasheets";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { formatDate } from "@/ravarer/lib/constants";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { useAllergens, useNutrition } from "@/ravarer/hooks/useNutrition";
import { useRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { ALLERGENS, formatNumber } from "@/ravarer/lib/constants";
import { diffAllergens, normalizeAllergenCode } from "@/ravarer/lib/allergenDiff";
import { NUTRITION_NUMBER_FIELDS } from "@/ravarer/lib/nutritionSource";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";

const NUTRITION_LABELS: Record<string, string> = {
  energy_kj: "Energi (kJ)",
  energy_kcal: "Energi (kcal)",
  fat_g: "Fett",
  saturated_fat_g: "— mettet",
  carbs_g: "Karbohydrater",
  sugars_g: "— sukkerarter",
  fiber_g: "Fiber",
  protein_g: "Protein",
  salt_g: "Salt",
};

const ALLERGEN_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(ALLERGENS.map((a) => [a.value, a.label]));

interface Props { rawMaterialId: string }

const FIELD_LABELS: Record<string, string> = {
  nutrition: "Næring",
  allergens: "Allergener",
  ingredient_declaration: "Ingrediensdeklarasjon",
  composite: "Sammensetning",
  grain: "Brødskala-klassifisering",
  package: "Pakningsstørrelse",
};

export function DatasheetSection({ rawMaterialId }: Props) {
  const { canWrite, legalEntityId } = useRavarer();
  const qc = useQueryClient();
  const { data: datasheets = [] } = useDatasheets(rawMaterialId);
  const { data: changelog = [] } = useChangelog({ rawMaterialId });
  const { data: currentNutrition } = useNutrition(rawMaterialId);
  const { data: currentAllergens = [] } = useAllergens(rawMaterialId);
  const { data: rm } = useRawMaterial(rawMaterialId);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<any | null>(null);
  const [datasheetId, setDatasheetId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  /** Felt-for-felt-valg på næring. Bare disse skrives. */
  const [acceptedNutrition, setAcceptedNutrition] = useState<Set<string>>(new Set());
  /** Fjerning av allergener er en matsikkerhetsbeslutning — aldri forhåndsvalgt. */
  const [allowRemovals, setAllowRemovals] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [packageSuggestion, setPackageSuggestion] = useState<{ size: number | null; unit: string | null } | null>(null);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);

  const allergenDiff = extracted?.allergens
    ? diffAllergens(currentAllergens, extracted.allergens as { allergen?: unknown; presence?: unknown }[])
    : null;
  const removals = allergenDiff?.removed ?? [];
  const removalsBlocked = (allergenDiff?.rejected.length ?? 0) > 0;

  const handleUpload = async (file: File) => {
    if (!canWrite) return;
    setUploading(true);
    try {
      if (!legalEntityId) throw new Error("Mangler valgt selskap (legal_entity_id)");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${legalEntityId}/${rawMaterialId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("raw-material-datasheets").upload(path, file);
      if (upErr) throw new Error(`Opplasting feilet: ${upErr.message}`);
      setUploading(false);
      setExtracting(true);
      const { data, error } = await supabase.functions.invoke("extract-datasheet", {
        body: { file_path: path, raw_material_id: rawMaterialId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setExtracted(data.extracted);
      setDatasheetId(data.datasheet_id);
      // Pre-select alle felter som har verdi
      const auto = new Set<string>();
      if (data.extracted.nutrition) auto.add("nutrition");
      if (data.extracted.allergens?.length) auto.add("allergens");
      if (data.extracted.ingredient_declaration) auto.add("ingredient_declaration");
      // «composite» velges bevisst ikke automatisk — komponentene må sees over først.
      if (data.extracted.grain_classification_hint) auto.add("grain");
      if (data.extracted.package_size_value) auto.add("package");
      setAccepted(auto);
    } catch (e: any) {
      toast.error(e.message ?? "Opplasting feilet");
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  const handleApply = async () => {
    if (!datasheetId) return;
    try {
      const fields = Array.from(accepted);
      if (allowRemovals && accepted.has("allergens")) fields.push("allergen_removals");
      const { data, error } = await supabase.functions.invoke("apply-datasheet-update", {
        body: {
          datasheet_id: datasheetId,
          raw_material_id: rawMaterialId,
          accepted_fields: fields,
          accepted_nutrition_fields: accepted.has("nutrition") ? Array.from(acceptedNutrition) : [],
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        throw new Error(`Noe ble ikke lagret: ${data.failures.join(" · ")}`);
      }
      if (!data.applied) {
        throw new Error("Databladet ble ikke registrert som anvendt. Ingenting er bekreftet.");
      }
      toast.success(`Lagret ${data.changes_logged} endringer · ${data.affected_products} produkter flagget`);
      const skipped = data.follow_ups?.allergen_removals_skipped;
      if (Array.isArray(skipped) && skipped.length > 0) {
        toast.warning(`Allergener som IKKE ble fjernet: ${skipped.join(", ")}. Fjern dem manuelt hvis det er riktig.`);
      }
      const pkg = data.follow_ups?.package_suggestion;
      // Pakningen er ikke lagret — den må bekreftes i pakningsdialogen.
      setPackageSuggestion(pkg ? { size: pkg.suggested?.size ?? null, unit: pkg.suggested?.unit ?? null } : null);
      setExtracted(null);
      setDatasheetId(null);
      setAllowRemovals(false);
      invalidateRawMaterial(qc, rawMaterialId);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleNutritionField = (f: string) => {
    setAcceptedNutrition((prev) => {
      const n = new Set(prev);
      n.has(f) ? n.delete(f) : n.add(f);
      return n;
    });
  };

  /** Minimal rad til pakningsdialogen — den henter selv resten den trenger. */
  const packageRow: PackageWorklistRow | null = rm
    ? {
        id: rm.id,
        legal_entity_id: legalEntityId ?? null,
        name: rm.name,
        base_unit: rm.base_unit,
        category: rm.category ?? null,
        current_cost_price: rm.current_cost_price ?? null,
        pakningsfaktor: null, faktor_kilde: null, bekreftet_dato: null,
        antall_fakturalinjer: null, antall_leverandorer: null, enheter_i_bruk: null,
        linjer_uten_pris: null, kjopt_kr_totalt: null, siste_faktura: null,
        pris_spredning: null, implisert_mengde: null, referansepris: null,
        referansekilde: null, referansedato: null, referanse_faktor: null,
        foreslatt_fra_navn: null, foreslatt_fra_referanse: null, status: null,
      }
    : null;

  const toggle = (k: string) => {
    const n = new Set(accepted);
    n.has(k) ? n.delete(k) : n.add(k);
    setAccepted(n);
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> Datablad
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="mr-1.5 h-3.5 w-3.5" /> Versjonshistorikk
        </Button>
      </div>

      {!extracted && canWrite && (
        <div className="rounded-xl border-2 border-dashed border-line-subtle p-6 text-center">
          <Upload className="mx-auto h-8 w-8 text-ink-secondary mb-2" />
          <p className="text-sm text-ink-secondary mb-3">Last opp leverandørens datablad (PDF eller bilde) for AI-ekstrahering.</p>
          <input
            type="file"
            id="ds-upload"
            className="hidden"
            accept="application/pdf,image/*"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
            disabled={uploading || extracting}
          />
          <label htmlFor="ds-upload">
            <Button asChild disabled={uploading || extracting}>
              <span className="cursor-pointer">
                {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Laster opp…</>
                  : extracting ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> AI analyserer…</>
                  : <><Upload className="mr-1.5 h-3.5 w-3.5" /> Velg fil</>}
              </span>
            </Button>
          </label>
        </div>
      )}

      {extracted && (
        <div className="rounded-xl border border-line-subtle bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-app" />
            AI fant {Object.keys(FIELD_LABELS).filter(k => isFieldPresent(extracted, k)).length} oppdaterbare felter
            {extracted.confidence != null && (
              <Badge variant="outline" className="text-xs">Confidence {Math.round(extracted.confidence * 100)}%</Badge>
            )}
          </div>
          <div className="space-y-2">
            {Object.entries(FIELD_LABELS).filter(([k]) => isFieldPresent(extracted, k)).map(([k, label]) => (
              <div key={k} className="rounded-lg bg-surface-raised p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox checked={accepted.has(k)} onCheckedChange={() => toggle(k)} />
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-ink-secondary mt-0.5">{summary(extracted, k)}</div>
                  </div>
                </label>
                {k === "nutrition" && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-ink-secondary">
                        <th className="py-1 text-left font-medium">Bruk</th>
                        <th className="py-1 text-left font-medium">Felt</th>
                        <th className="py-1 text-right font-medium">I dag</th>
                        <th className="py-1 text-right font-medium">Fra datablad</th>
                        <th className="py-1 text-right font-medium">Endring</th>
                      </tr>
                    </thead>
                    <tbody>
                      {NUTRITION_NUMBER_FIELDS.filter((f) => extracted.nutrition?.[f] != null).map((f) => {
                        const oldV = (currentNutrition?.[f] ?? null) as number | null;
                        const newV = Number(extracted.nutrition[f]);
                        return (
                          <tr key={f} className="border-t border-line-subtle/60">
                            <td className="py-1">
                              <Checkbox
                                aria-label={`Bruk ${NUTRITION_LABELS[f] ?? f} fra databladet`}
                                checked={acceptedNutrition.has(f)}
                                disabled={!accepted.has("nutrition")}
                                onCheckedChange={() => toggleNutritionField(f)}
                              />
                            </td>
                            <td className="py-1">{NUTRITION_LABELS[f] ?? f}</td>
                            <td className="py-1 text-right tabular-nums">{oldV == null ? "—" : formatNumber(oldV, 1)}</td>
                            <td className="py-1 text-right tabular-nums font-medium">{formatNumber(newV, 1)}</td>
                            <td className="py-1 text-right tabular-nums">{changePct(oldV, newV)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {k === "allergens" && (
                  <>
                    <AllergenPreview current={currentAllergens} incoming={extracted.allergens ?? []} />
                    {removals.length > 0 && (
                      <label className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={allowRemovals}
                          disabled={!accepted.has("allergens") || removalsBlocked}
                          onCheckedChange={() => setAllowRemovals(v => !v)}
                          aria-label="Bekreft fjerning av allergener"
                        />
                        <span>
                          <span className="font-medium">Fjern {removals.length} allergen(er)</span> — dette er ikke valgt
                          på forhånd. Før: {removals.map(r => `${r.allergen} (${r.presence})`).join(", ")} · Etter: ikke oppført.
                          {removalsBlocked && " Ugyldige verdier i databladet gjør at fjerning er sperret."}
                        </span>
                      </label>
                    )}
                  </>
                )}
                {k === "ingredient_declaration" && (
                  <BeforeAfter
                    before={currentNutrition?.ingredient_declaration ?? null}
                    after={extracted.ingredient_declaration}
                  />
                )}
                {k === "grain" && (
                  <BeforeAfter before={rm?.grain_classification ?? null} after={extracted.grain_classification_hint} />
                )}
                {k === "package" && (
                  <BeforeAfter
                    before={rm?.package_size != null ? `${rm.package_size} ${rm.package_unit ?? ""}`.trim() : null}
                    after={`${extracted.package_size_value} ${extracted.package_size_unit ?? ""}`.trim()}
                  />
                )}
                {k === "composite" && (
                  <p className="mt-2 text-xs text-ink-secondary">
                    Komponentene lagres som forslag til gjennomgang. Råvarens egen næring og allergener beholdes.
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setExtracted(null); setDatasheetId(null); }}>Avbryt</Button>
            <Button
              onClick={handleApply}
              disabled={accepted.size === 0 || (accepted.has("nutrition") && acceptedNutrition.size === 0)}
            >
              Anvend valgte ({accepted.size})
            </Button>
          </div>
        </div>
      )}

      {packageSuggestion && (
        <div className="rounded-xl border border-line-subtle bg-muted/30 p-3 text-sm flex items-center justify-between gap-3">
          <span>
            Databladet foreslår pakning{" "}
            <span className="font-medium">
              {packageSuggestion.size ?? "—"} {packageSuggestion.unit ?? ""}
            </span>
            . Dette er <span className="font-medium">ikke lagret</span> — bekreft i pakningsdialogen.
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setPackageDialogOpen(true)} disabled={!canWrite || !packageRow}>
              Åpne pakning
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPackageSuggestion(null)}>Skjul</Button>
          </div>
        </div>
      )}

      <SetPackageDialog
        row={packageDialogOpen ? packageRow : null}
        open={packageDialogOpen}
        onOpenChange={setPackageDialogOpen}
        suggestion={packageSuggestion}
      />

      {datasheets.length > 0 && (
        <div className="text-xs text-ink-secondary">
          {datasheets.length} datablad lastet opp · siste {formatDate(datasheets[0].uploaded_at)}
        </div>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Versjonshistorikk</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {datasheets.length === 0 && changelog.length === 0 && (
              <p className="text-sm text-ink-secondary">Ingen historikk.</p>
            )}
            {datasheets.map(ds => (
              <div key={ds.id} className="rounded-lg border border-line-subtle p-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">📅 {formatDate(ds.uploaded_at)} · Datablad lastet opp</div>
                  {ds.is_current && <Badge variant="secondary" className="text-xs">Gjeldende</Badge>}
                </div>
                <div className="text-xs text-ink-secondary mt-1">{ds.file_name}</div>
              </div>
            ))}
            {changelog.map(c => (
              <div key={c.id} className="rounded-lg border border-line-subtle p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span>{c.severity === "high" ? "🔴" : c.severity === "medium" ? "🟡" : "⚪"}</span>
                  <span className="font-medium">{describeChange(c)}</span>
                </div>
                <div className="text-xs text-ink-secondary mt-1">{formatDate(c.created_at)}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function changePct(oldV: number | null, newV: number): string {
  if (oldV == null || oldV === 0) return oldV == null ? "ny" : "—";
  const pct = ((newV - oldV) / Math.abs(oldV)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${formatNumber(pct, 1)} %`;
}

function BeforeAfter({ before, after }: { before: string | null; after: string | null | undefined }) {
  return (
    <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
      <div>
        <div className="text-ink-secondary">I dag</div>
        <div className="rounded bg-muted px-2 py-1">{before || "—"}</div>
      </div>
      <div>
        <div className="text-ink-secondary">Fra datablad</div>
        <div className="rounded bg-muted px-2 py-1 font-medium">{after || "—"}</div>
      </div>
    </div>
  );
}

function AllergenPreview({
  current,
  incoming,
}: {
  current: { allergen: string; presence: string }[];
  incoming: { allergen?: unknown; presence?: unknown }[];
}) {
  const diff = diffAllergens(current, incoming);
  const name = (code: string) => ALLERGEN_LABEL_BY_CODE[normalizeAllergenCode(code) ?? code] ?? code;
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0 && diff.rejected.length === 0) {
    return <p className="mt-2 text-xs text-ink-secondary">Ingen endring i allergener.</p>;
  }
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {diff.added.map((a) => (
        <li key={`a-${a.allergen}`} className="text-success">+ {name(a.allergen)} ({a.presence === "contains" ? "inneholder" : "kan inneholde spor"})</li>
      ))}
      {diff.changed.map((c) => (
        <li key={`c-${c.allergen}`}>{name(c.allergen)}: {c.from} → {c.to}</li>
      ))}
      {diff.removed.map((r) => (
        <li key={`r-${r.allergen}`} className="text-destructive">− {name(r.allergen)} fjernes</li>
      ))}
      {diff.rejected.length > 0 && (
        <li className="text-warning">Forkastet (ukjent kode): {diff.rejected.join(", ")}</li>
      )}
    </ul>
  );
}

function isFieldPresent(ext: any, key: string): boolean {
  switch (key) {
    case "nutrition": return ext.nutrition && Object.values(ext.nutrition).some(v => v != null);
    case "allergens": return Array.isArray(ext.allergens) && ext.allergens.length > 0;
    case "ingredient_declaration": return !!ext.ingredient_declaration;
    case "composite": return Array.isArray(ext.composite_components) && ext.composite_components.length > 0;
    case "grain": return !!ext.grain_classification_hint;
    case "package": return ext.package_size_value != null;
  }
  return false;
}

function summary(ext: any, key: string): string {
  switch (key) {
    case "nutrition": return `Energi ${ext.nutrition?.energy_kcal ?? "?"} kcal · Protein ${ext.nutrition?.protein_g ?? "?"} g · Fett ${ext.nutrition?.fat_g ?? "?"} g`;
    case "allergens": return ext.allergens.map((a: any) => `${a.allergen} (${a.presence})`).join(", ");
    case "ingredient_declaration": return ext.ingredient_declaration.slice(0, 120) + (ext.ingredient_declaration.length > 120 ? "…" : "");
    case "composite": return ext.composite_components.map((c: any) => c.name + (c.percentage ? ` (${c.percentage}%)` : "")).join(", ");
    case "grain": return ext.grain_classification_hint;
    case "package": return `${ext.package_size_value} ${ext.package_size_unit ?? ""}`;
  }
  return "";
}

function describeChange(c: any): string {
  const map: Record<string, string> = {
    allergen_added: `Allergen lagt til: ${c.field}`,
    allergen_removed: `Allergen fjernet: ${c.field}`,
    nutrition_changed: `${c.field}: ${c.old_value ?? "—"} → ${c.new_value}`,
    composition_changed: `Sammensetning endret`,
    grain_changed: `Brødskala: ${c.old_value ?? "—"} → ${c.new_value}`,
    package_changed: `Pakning endret`,
    created: "Råvare opprettet",
  };
  return map[c.change_type] ?? c.change_type;
}
