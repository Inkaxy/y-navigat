import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Link2Off, Clock, HelpCircle } from "lucide-react";
import { ScalePanel } from "@/varer/components/recipes/ScalePanel";
import { useRecipePDF, buildRecipePDFData } from "@/varer/hooks/useRecipePDF";
import {
  computeTotals, scaleFactor, scaleLines, scaledSummary, roundBakerGrams, weighingOrder,
  lineDisplayName, fmtG, fmtPercent, fmtDuration, isFlourLine,
  PREFERMENT_KIND_OPTIONS, STEP_TYPE_LABEL, type BakersLine,
} from "@/varer/lib/bakers";

const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

const ERROR_TEXT: Record<string, { title: string; body: string; icon: typeof HelpCircle }> = {
  invalid_token: {
    title: "Vi finner ikke denne oppskriften",
    body: "Lenken ser ut til å være feil, eller den har aldri eksistert. Sjekk at du har hele adressen, eller be om en ny lenke.",
    icon: HelpCircle,
  },
  revoked: {
    title: "Lenken er stengt",
    body: "Den som delte oppskriften har trukket lenken tilbake. Ta kontakt hvis du fortsatt trenger tilgang.",
    icon: Link2Off,
  },
  expired: {
    title: "Lenken har gått ut på dato",
    body: "Denne delingen var tidsbegrenset og gjelder ikke lenger. Be om en ny lenke.",
    icon: Clock,
  },
  rate_limited: {
    title: "For mange forsøk",
    body: "Vent et par minutter og prøv igjen.",
    icon: Clock,
  },
  network: {
    title: "Vi fikk ikke hentet oppskriften",
    body: "Sjekk nettforbindelsen og prøv å laste siden på nytt.",
    icon: HelpCircle,
  },
};

interface Bundle {
  link: { label: string | null; include_costs: boolean; expires_at: string | null };
  recipe: any;
  parts: any[];
  lines: any[];
  steps: any[];
  totals: any;
}

export default function PublicRecipe() {
  const { token } = useParams<{ token: string }>();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [scaleInput, setScaleInput] = useState("");
  const [mixerCapacity, setMixerCapacity] = useState("");
  const { generating, printRecipeCard } = useRecipePDF();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${FN_BASE}/validate-recipe-share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.result !== "ok") {
          setErrorCode(data.result ?? "network");
          return;
        }
        setBundle(data as Bundle);
        document.title = `${data.recipe?.name ?? "Oppskrift"} — Nøtterø Bakeri`;
      } catch {
        if (!cancelled) setErrorCode("network");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const recipe = bundle?.recipe;
  const lines: BakersLine[] = useMemo(() => (bundle?.lines ?? []) as BakersLine[], [bundle]);

  const baseTotals = useMemo(
    () => computeTotals(lines, Number(recipe?.unit_weight_grams) || null),
    [lines, recipe],
  );

  const baseUnits = useMemo(() => {
    const u = Number(recipe?.units_per_batch) || 0;
    if (u > 0) return u;
    return baseTotals.unitCount && baseTotals.unitCount > 0 ? baseTotals.unitCount : 1;
  }, [recipe, baseTotals.unitCount]);

  useEffect(() => { setScaleInput(String(baseUnits)); }, [baseUnits]);

  const desiredUnits = Number(scaleInput) || 0;
  const factor = scaleFactor(desiredUnits, baseUnits);
  const isScaled = Math.abs(factor - 1) > 0.0001;

  const summary = useMemo(
    () => scaledSummary(lines, factor, Number(recipe?.unit_weight_grams) || null, desiredUnits || baseUnits, Number(mixerCapacity) || null),
    [lines, factor, recipe, desiredUnits, baseUnits, mixerCapacity],
  );

  const displayLines: BakersLine[] = useMemo(() => {
    if (!isScaled) return lines;
    const scaled = scaleLines(lines, factor, baseTotals.totalFlourG);
    return lines.map((l, i) => ({
      ...l,
      quantity: roundBakerGrams(scaled[i].exactGrams),
      unit: "g",
      _displayPercent: scaled[i].percent,
    }));
  }, [lines, isScaled, factor, baseTotals.totalFlourG]);

  const totals = isScaled ? summary.totals : baseTotals;

  const orderedParts = useMemo(() => {
    const parts = bundle?.parts ?? [];
    const rank = (p: any) => (p.part_type === "preferment" ? 0 : p.part_type === "dough" ? 1 : 2);
    return [...parts].sort((a, b) => rank(a) - rank(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [bundle]);

  function percentFor(l: BakersLine) {
    if (l._displayPercent != null) return l._displayPercent;
    const flour = baseTotals.totalFlourG;
    if (!flour) return 0;
    const g = Number(l.quantity) || 0;
    return (g * (l.unit === "kg" ? 1000 : 1) / flour) * 100;
  }

  function partTitle(p: any) {
    if (p.part_type === "preferment") {
      const kind = PREFERMENT_KIND_OPTIONS.find((k) => k.value === p.preferment_kind)?.label;
      return kind ? `${p.name} · ${kind}` : p.name;
    }
    return p.name;
  }

  function downloadCard() {
    if (!recipe) return;
    printRecipeCard(
      buildRecipePDFData({
        name: recipe.name,
        category: recipe.category,
        version: recipe.version,
        description: recipe.description,
        imageUrl: recipe.image_url,
        unitWeightGrams: recipe.unit_weight_grams,
        targetDoughTemp: recipe.target_dough_temp_celsius,
        frictionFactor: recipe.friction_factor_celsius,
        scaledUnits: summary.unitCount ?? desiredUnits ?? baseUnits,
        factor,
        parts: orderedParts.map((p) => ({
          id: p.id, name: p.name, part_type: p.part_type, preferment_kind: p.preferment_kind,
          target_temp_celsius: p.target_temp_celsius, ripe_time_hours: p.ripe_time_hours, instructions: p.instructions,
        })),
        lines,
        steps: (bundle?.steps ?? []).map((s: any) => ({
          step_type: s.step_type, title: s.title, instruction: s.instruction,
          duration_minutes: s.duration_minutes, temp_celsius: s.temp_celsius, humidity_pct: s.humidity_pct,
        })),
        includeCosts: !!bundle?.link.include_costs,
      }),
      { includeCosts: !!bundle?.link.include_costs, includeImage: !!recipe.image_url },
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (errorCode || !bundle || !recipe) {
    const e = ERROR_TEXT[errorCode ?? "network"] ?? ERROR_TEXT.network;
    const Icon = e.icon;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <Icon className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h1 className="mb-2 text-xl font-semibold">{e.title}</h1>
          <p className="text-sm text-muted-foreground">{e.body}</p>
          <p className="mt-10 text-xs text-muted-foreground">Delt fra Nøtterø Bakeri &amp; Konditori</p>
        </div>
      </main>
    );
  }

  const steps = bundle.steps ?? [];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          {recipe.category && (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{recipe.category}</p>
          )}
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{recipe.name}</h1>
          {recipe.description && (
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">{recipe.description}</p>
          )}
        </header>

        {recipe.image_url && (
          <img
            src={recipe.image_url}
            alt={`Bilde av ${recipe.name}`}
            loading="lazy"
            className="mb-6 aspect-[16/9] w-full rounded-lg object-cover"
          />
        )}

        <div className="mb-6 space-y-3">
          <ScalePanel
            value={scaleInput}
            onChange={setScaleInput}
            baseUnits={baseUnits}
            mixerCapacity={mixerCapacity}
            onMixerCapacityChange={setMixerCapacity}
            summary={summary}
            isScaled={isScaled}
            onReset={() => setScaleInput(String(baseUnits))}
          />
          <Button variant="outline" onClick={downloadCard} disabled={generating !== null}>
            {generating === "card" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Last ned som PDF
          </Button>
        </div>

        <section className="space-y-4">
          {orderedParts.map((p) => {
            const partLines = weighingOrder(displayLines.filter((l) => l.recipe_part_id === p.id));
            if (partLines.length === 0) return null;
            return (
              <Card key={p.id}>
                <CardContent className="py-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{partTitle(p)}</h2>
                    {p.part_type === "preferment" && <Badge variant="secondary">Fordeig</Badge>}
                    {p.ripe_time_hours != null && (
                      <span className="text-xs text-muted-foreground">Modning {p.ripe_time_hours} t</span>
                    )}
                    {p.target_temp_celsius != null && (
                      <span className="text-xs text-muted-foreground">{p.target_temp_celsius} °C</span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {partLines.map((l) => (
                        <tr key={l.id} className="border-t border-border/60">
                          <td className="py-1.5 pr-3">
                            <span className={isFlourLine(l) ? "font-medium" : ""}>{lineDisplayName(l)}</span>
                          </td>
                          <td className="w-24 py-1.5 text-right tabular-nums">
                            {fmtG(Number(l.quantity) * (l.unit === "kg" ? 1000 : 1))} {l.unit === "stk" ? "stk" : "g"}
                          </td>
                          <td className="w-20 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                            {fmtPercent(percentFor(l))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.instructions && (
                    <p className="mt-3 text-sm text-muted-foreground">{p.instructions}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>

        {steps.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-base font-semibold">Slik gjør du</h2>
            <ol className="space-y-4">
              {steps.map((s: any, i: number) => (
                <li key={s.id ?? i} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                    {i + 1}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.title || STEP_TYPE_LABEL[s.step_type] || "Trinn"}</span>
                      {s.duration_minutes != null && (
                        <span className="text-xs text-muted-foreground">{fmtDuration(s.duration_minutes)}</span>
                      )}
                      {s.temp_celsius != null && (
                        <span className="text-xs text-muted-foreground">{s.temp_celsius} °C</span>
                      )}
                      {s.humidity_pct != null && (
                        <span className="text-xs text-muted-foreground">{s.humidity_pct} % RF</span>
                      )}
                    </div>
                    {s.instruction && (
                      <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.instruction}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border px-4 py-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Melvekt</div>
            <div className="tabular-nums">{fmtG(totals.totalFlourG)} g</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Deigvekt</div>
            <div className="tabular-nums">{fmtG(totals.totalDoughG)} g</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Hydrering</div>
            <div className="tabular-nums">{fmtPercent(totals.hydrationPct)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Salt</div>
            <div className="tabular-nums">{fmtPercent(totals.saltPct)}</div>
          </div>
          {bundle.totals?.prefermentedFlourPct > 0 && (
            <div>
              <div className="text-xs text-muted-foreground">Forfermentert mel</div>
              <div className="tabular-nums">{fmtPercent(bundle.totals.prefermentedFlourPct)}</div>
            </div>
          )}
          {recipe.target_dough_temp_celsius != null && (
            <div>
              <div className="text-xs text-muted-foreground">Deigtemperatur</div>
              <div className="tabular-nums">{recipe.target_dough_temp_celsius} °C</div>
            </div>
          )}
          {totals.unitCount != null && (
            <div>
              <div className="text-xs text-muted-foreground">Utbytte</div>
              <div className="tabular-nums">{totals.unitCount} stk</div>
            </div>
          )}
        </section>

        <footer className="mt-12 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          Delt fra Nøtterø Bakeri &amp; Konditori
        </footer>
      </div>
    </main>
  );
}
