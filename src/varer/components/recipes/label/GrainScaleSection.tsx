import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COARSE_CLASSIFICATIONS,
  GRAIN_LEVELS,
  SIFTED_CLASSIFICATIONS,
  fmtGrams,
  fmtPct,
  gramsToNextLevel,
  grainCategoryFromPct,
  type FlourLine,
  type GrainCategory,
} from "@/varer/lib/breadscale";
import { BrodskalanMark } from "@/varer/components/label/BrodskalanMark";
import { brodskalanFor, hasBrodskalanWarning } from "@/varer/lib/brodskalan";

interface Props {
  grainPct: number | null;
  grainCategory: string | null;
  flourGrams: number | null;
  coarseWeightedGrams: number | null;
  flourLines: FlourLine[];
  /** Advarsler fra compute-recipe-label — brukes til forbehold på merket. */
  warnings?: string[] | null;
}

/** NBhubs egen strektegning av Brødskala'n — ikke merkeordningens offisielle logo. */
function GrainScaleSvg({ active }: { active: GrainCategory | null }) {
  const w = 320;
  const stepW = w / 4;
  return (
    <svg viewBox={`0 0 ${w} 64`} className="h-16 w-full max-w-[340px]" role="img" aria-label="Grovhetsskala">
      {GRAIN_LEVELS.map((l, i) => {
        const isActive = l.key === active;
        return (
          <g key={l.key}>
            <rect
              x={i * stepW + 2}
              y={10}
              width={stepW - 4}
              height={26}
              rx={4}
              fill={isActive ? "hsl(var(--primary))" : "transparent"}
              stroke="hsl(var(--foreground))"
              strokeWidth={isActive ? 0 : 1}
              opacity={isActive ? 1 : 0.35}
            />
            <text
              x={i * stepW + stepW / 2}
              y={27}
              textAnchor="middle"
              fontSize="11"
              fontWeight={isActive ? 700 : 500}
              fill={isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))"}
            >
              {l.label}
            </text>
            <text
              x={i * stepW + stepW / 2}
              y={50}
              textAnchor="middle"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {l.rangeText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Grovhet — skala, grenser og konkret bytteforslag til neste nivå. */
export function GrainScaleSection({
  grainPct,
  grainCategory,
  flourGrams,
  coarseWeightedGrams,
  flourLines,
  warnings,
}: Props) {
  const category = (grainCategory as GrainCategory | null) ?? (grainPct != null ? grainCategoryFromPct(grainPct) : null);

  const siftedLines = useMemo(
    () => flourLines.filter((l) => l.classification && SIFTED_CLASSIFICATIONS.includes(l.classification) && l.grams > 0),
    [flourLines],
  );
  const coarseLines = useMemo(
    () => flourLines.filter((l) => l.classification && COARSE_CLASSIFICATIONS.includes(l.classification)),
    [flourLines],
  );

  const [fromId, setFromId] = useState<string>("");
  const [toName, setToName] = useState<string>("");

  const from = siftedLines.find((l) => (l.raw_material_id ?? l.name) === fromId) ?? siftedLines[0];
  const target = coarseLines.find((l) => l.name === toName) ?? coarseLines[0];

  const uncertain = hasBrodskalanWarning(warnings);

  const next = gramsToNextLevel(coarseWeightedGrams ?? 0, flourGrams ?? 0);
  const enough = next && from ? from.grams >= next.gramsNeeded : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Grovhet — Brødskala'n</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <GrainScaleSvg active={category} />
          <div>
            <div className="text-2xl font-semibold tabular-nums">{fmtPct(grainPct)}</div>
            <div className="text-sm text-muted-foreground">
              {GRAIN_LEVELS.find((l) => l.key === category)?.label ?? "Ikke beregnet"}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Grensene: fint under 26 %, halvgrovt 26–50,9 %, grovt 51–75,9 %, ekstra grovt fra 76 %. Regnet av
          {" "}{fmtGrams(coarseWeightedGrams ?? 0)} vektet grovt korn på {fmtGrams(flourGrams ?? 0)} mel.
        </p>

        <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
          <BrodskalanMark category={category} sizeMm={22} showText muted={uncertain} />
          <div className="min-w-[200px] flex-1 text-sm">
            {brodskalanFor(category) ? (
              <>
                <div className="font-medium">
                  {fmtPct(grainPct)} grovhet — {brodskalanFor(category)!.label}
                </div>
                <p className="text-xs text-muted-foreground">
                  Offisielt Brødskala'n-merke fra Baker- og Konditorbransjens Landsforening.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Grovheten er ikke beregnet — merket vises ikke før beregningen er kjørt.
              </p>
            )}
            {uncertain && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Forbehold: noen ingredienser mangler kornklassifisering, så grovheten kan være feil.
                  Brødskala'n er en lisensiert merkeordning — rett opp klassifiseringen før merket trykkes.
                </span>
              </div>
            )}
          </div>
        </div>

        {next && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-sm">
              Du er på <b>{fmtPct(grainPct)}</b> — {GRAIN_LEVELS.find((l) => l.key === category)?.label.toLowerCase()}.
              {" "}Til <b>{next.next.label.toLowerCase()}</b> mangler {fmtGrams(next.gramsNeeded)} grovt korn.
            </div>
            {siftedLines.length > 0 && coarseLines.length > 0 ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Bytt fra</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={fromId || (from ? from.raw_material_id ?? from.name : "")}
                      onChange={(e) => setFromId(e.target.value)}
                    >
                      {siftedLines.map((l) => (
                        <option key={l.raw_material_id ?? l.name} value={l.raw_material_id ?? l.name}>
                          {l.name} ({fmtGrams(l.grams)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Til</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={toName || (target?.name ?? "")}
                      onChange={(e) => setToName(e.target.value)}
                    >
                      {coarseLines.map((l) => (
                        <option key={l.name} value={l.name}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {from && target && (
                  <p className={cn("text-sm", enough ? "text-foreground" : "text-amber-700")}>
                    Bytt <b>{fmtGrams(next.gramsNeeded)}</b> {from.name.toLowerCase()} mot {target.name.toLowerCase()},
                    så er brødet {next.next.label.toLowerCase()}.
                    {!enough && ` Merk: oppskriften har bare ${fmtGrams(from.grams)} ${from.name.toLowerCase()} — bytt også en annen meltype.`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {siftedLines.length === 0
                  ? "Ingen siktet mel å bytte fra."
                  : "Oppskriften har ingen fullkornsråvare å bytte til — legg til en sammalt meltype først."}
              </p>
            )}
          </div>
        )}
        {!next && grainPct != null && (
          <Badge variant="secondary">Høyeste nivå er nådd — ekstra grovt</Badge>
        )}
      </CardContent>
    </Card>
  );
}
