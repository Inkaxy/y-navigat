import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2, Lock, RefreshCw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/userError";
import {
  COARSE_CLASSIFICATIONS,
  GRAIN_LEVELS,
  SIFTED_CLASSIFICATIONS,
  fmtGrams,
  fmtNum,
  fmtPct,
  gramsToNextLevel,
  grainCategoryFromPct,
  type FlourLine,
  type GrainCategory,
} from "@/varer/lib/breadscale";
import { BrodskalanMark } from "@/varer/components/label/BrodskalanMark";
import { brodskalanFor, hasBrodskalanWarning } from "@/varer/lib/brodskalan";
import { useSyncBreadscaleProducts, useUserDisplayName } from "@/varer/hooks/useRecipeLabel";
import { DiffNote, SourceColumn, SourceSegmented, formatDateTimeNb } from "./labelShared";

/** NBhubs egen strektegning av skalaen — ikke merkeordningens offisielle logo. */
export function GrainScaleSvg({ active, compact }: { active: GrainCategory | null; compact?: boolean }) {
  const w = 320;
  const stepW = w / 4;
  return (
    <svg
      viewBox={`0 0 ${w} 64`}
      className={cn("w-full", compact ? "h-12 max-w-[280px]" : "h-16 max-w-[340px]")}
      role="img"
      aria-label="Grovhetsskala"
    >
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
            <text x={i * stepW + stepW / 2} y={50} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
              {l.rangeText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const REPRESENTATIVE_PCT: Record<GrainCategory, number> = {
  fint: 13,
  halvgrovt: 38,
  grovt: 63,
  ekstra_grovt: 88,
};

function parsePct(v: string): number | null {
  const n = Number(v.replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

interface Props {
  recipeId: string;
  breadscaleMode: "auto" | "manual";
  manualPct: number | null;
  claimGrain: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  /** Beregnet grunnlag fra recipe_label_calculated. */
  grainPct: number | null;
  grainCategory: string | null;
  flourGrams: number | null;
  coarseWeightedGrams: number | null;
  wholeGrainPctOfDry: number | null;
  dryMatterPct: number | null;
  finalWeightGrams: number | null;
  warnings: string[] | null;
  flourLines: FlourLine[];
  canWrite: boolean;
  savingClaim: boolean;
  onToggleClaim: (value: boolean) => void;
}

/** Grovhet — Brødskala'n: beregnet og manuell side om side, egen bryter. */
export function GrainSection({
  recipeId,
  breadscaleMode,
  manualPct,
  claimGrain,
  approvedAt,
  approvedBy,
  grainPct,
  grainCategory,
  flourGrams,
  coarseWeightedGrams,
  wholeGrainPctOfDry,
  dryMatterPct,
  finalWeightGrams,
  warnings,
  flourLines,
  canWrite,
  savingClaim,
  onToggleClaim,
}: Props) {
  const qc = useQueryClient();
  const manualActive = breadscaleMode === "manual";
  const syncProducts = useSyncBreadscaleProducts();
  const approverName = useUserDisplayName(approvedBy).data;

  const calcCategory: GrainCategory | null =
    (grainCategory as GrainCategory | null) ?? (grainPct != null ? grainCategoryFromPct(grainPct) : null);

  const [manualInput, setManualInput] = useState(manualPct != null ? fmtNum(manualPct, 1) : "");
  useEffect(() => {
    setManualInput(manualPct != null ? fmtNum(manualPct, 1) : "");
  }, [manualPct]);

  const manualParsed = parsePct(manualInput);
  const manualCategory = manualParsed != null ? grainCategoryFromPct(manualParsed) : null;
  const manualDirty = (manualParsed ?? null) !== (manualPct ?? null);

  const siftedLines = useMemo(
    () => flourLines.filter((l) => l.classification && SIFTED_CLASSIFICATIONS.includes(l.classification) && l.grams > 0),
    [flourLines],
  );
  const coarseLines = useMemo(
    () => flourLines.filter((l) => l.classification && COARSE_CLASSIFICATIONS.includes(l.classification)),
    [flourLines],
  );
  const [fromId, setFromId] = useState("");
  const [toName, setToName] = useState("");
  const from = siftedLines.find((l) => (l.raw_material_id ?? l.name) === fromId) ?? siftedLines[0];
  const target = coarseLines.find((l) => l.name === toName) ?? coarseLines[0];
  const uncertain = hasBrodskalanWarning(warnings);
  const next = gramsToNextLevel(coarseWeightedGrams ?? 0, flourGrams ?? 0);
  const enough = next && from ? from.grams >= next.gramsNeeded : false;

  const effectivePct = manualActive ? manualPct : grainPct;
  const effectiveCategory = effectivePct != null ? grainCategoryFromPct(effectivePct) : null;

  const setMode = useMutation({
    mutationFn: async (m: "auto" | "manual") => {
      const { error } = await supabase.from("recipes").update({ breadscale_mode: m } as never).eq("id", recipeId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
      const n = await syncProducts.mutateAsync(recipeId);
      const pct = m === "manual" ? manualPct : grainPct;
      const cat = pct != null ? grainCategoryFromPct(pct) : null;
      return { n, pct, cat };
    },
    onSuccess: ({ n, pct, cat }) =>
      toast.success(
        cat
          ? `Grovhet: ${fmtPct(pct)} · Trinn ${GRAIN_LEVELS.findIndex((l) => l.key === cat) + 1} ${GRAIN_LEVELS.find((l) => l.key === cat)!.label} følger nå produktet (${n} produkter oppdatert)`
          : `Grovhetskilden er lagret (${n} produkter oppdatert)`,
      ),
    onError: (e: unknown) => showError("GrainSection", e),
  });

  const saveManual = useMutation({
    mutationFn: async () => {
      const value = manualInput.trim() === "" ? null : manualParsed;
      if (value != null && (value < 0 || value > 100)) throw new Error("Grovhet må være mellom 0 og 100 %");
      const { error } = await supabase
        .from("recipes")
        .update({ manual_breadscale_pct: value } as never)
        .eq("id", recipeId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
      return syncProducts.mutateAsync(recipeId);
    },
    onSuccess: () => toast.success("Manuell grovhet lagret"),
    onError: (e: unknown) => showError("GrainSection", e),
  });

  const busy = setMode.isPending || saveManual.isPending || syncProducts.isPending;
  const claimLocked = effectivePct == null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Grovhet — Brødskala'n</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <SourceSegmented
            value={manualActive ? "manual" : "auto"}
            disabled={!canWrite || busy}
            onChange={(v) => setMode.mutate(v)}
          />
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                syncProducts.mutate(recipeId, {
                  onSuccess: (n) => toast.success(`${n} produkter oppdatert`),
                  onError: (e: unknown) => showError("GrainSection", e),
                })
              }
            >
              {syncProducts.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Synk produkter nå
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---------- Beregnet ---------- */}
          <SourceColumn title="Beregnet av NBhub" active={!manualActive}>
            <div className="flex flex-wrap items-center gap-4">
              <GrainScaleSvg active={calcCategory} />
              <div>
                <div className="text-2xl font-semibold tabular-nums">{fmtPct(grainPct)}</div>
                <div className="text-sm text-muted-foreground">
                  {GRAIN_LEVELS.find((l) => l.key === calcCategory)?.label ?? "Ikke beregnet"}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Grensene: fint under 26 %, halvgrovt 26–50,9 %, grovt 51–75,9 %, ekstra grovt fra 76 %. Regnet av{" "}
              {fmtGrams(coarseWeightedGrams ?? 0)} vektet grovt korn på {fmtGrams(flourGrams ?? 0)} mel.
            </p>

            <p className="text-xs tabular-nums text-muted-foreground">
              Grunnlag: fullkorn av tørrstoff {fmtPct(wholeGrainPctOfDry)} · tørrstoff {fmtPct(dryMatterPct)} ·
              ferdigvekt {finalWeightGrams != null ? fmtGrams(finalWeightGrams) : "—"}
            </p>

            <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
              <BrodskalanMark category={calcCategory} sizeMm={22} showText muted={uncertain} />
              <div className="min-w-[200px] flex-1 text-sm">
                {brodskalanFor(calcCategory) ? (
                  <>
                    <div className="font-medium">
                      {fmtPct(grainPct)} grovhet — {brodskalanFor(calcCategory)!.label}
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
                  Du er på <b>{fmtPct(grainPct)}</b> —{" "}
                  {GRAIN_LEVELS.find((l) => l.key === calcCategory)?.label.toLowerCase()}. Til{" "}
                  <b>{next.next.label.toLowerCase()}</b> mangler {fmtGrams(next.gramsNeeded)} grovt korn.
                </div>
                {siftedLines.length > 0 && coarseLines.length > 0 ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Bytt fra</Label>
                        <Select
                          value={fromId || (from ? (from.raw_material_id ?? from.name) : "")}
                          onValueChange={setFromId}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Velg meltype" />
                          </SelectTrigger>
                          <SelectContent>
                            {siftedLines.map((l) => (
                              <SelectItem key={l.raw_material_id ?? l.name} value={l.raw_material_id ?? l.name}>
                                {l.name} ({fmtGrams(l.grams)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Til</Label>
                        <Select value={toName || (target?.name ?? "")} onValueChange={setToName}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Velg fullkorn" />
                          </SelectTrigger>
                          <SelectContent>
                            {coarseLines.map((l) => (
                              <SelectItem key={l.name} value={l.name}>
                                {l.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {from && target && (
                      <p className={cn("text-sm", enough ? "text-foreground" : "text-amber-700")}>
                        Bytt <b>{fmtGrams(next.gramsNeeded)}</b> {from.name.toLowerCase()} mot{" "}
                        {target.name.toLowerCase()}, så er brødet {next.next.label.toLowerCase()}.
                        {!enough &&
                          ` Merk: oppskriften har bare ${fmtGrams(from.grams)} ${from.name.toLowerCase()} — bytt også en annen meltype.`}
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
            {!next && grainPct != null && <Badge variant="secondary">Høyeste nivå er nådd — ekstra grovt</Badge>}
          </SourceColumn>

          {/* ---------- Manuell ---------- */}
          <SourceColumn title="Manuell" active={manualActive}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label className="text-xs">Grovhet (%)</Label>
                <Input
                  inputMode="decimal"
                  value={manualInput}
                  disabled={!canWrite}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="0–100"
                  className="text-right tabular-nums"
                />
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {manualParsed != null ? fmtPct(manualParsed) : "—"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {manualCategory
                    ? `Trinn ${GRAIN_LEVELS.findIndex((l) => l.key === manualCategory) + 1} ${GRAIN_LEVELS.find((l) => l.key === manualCategory)!.label}`
                    : "Ingen manuell grovhet lagt inn"}
                </div>
              </div>
            </div>

            <GrainScaleSvg active={manualCategory} compact />

            <div className="flex flex-wrap gap-2">
              {GRAIN_LEVELS.map((l) => (
                <Button
                  key={l.key}
                  variant="outline"
                  size="sm"
                  disabled={!canWrite}
                  onClick={() => {
                    if (manualInput.trim() === "") setManualInput(fmtNum(REPRESENTATIVE_PCT[l.key], 1));
                    else setManualInput(fmtNum(REPRESENTATIVE_PCT[l.key], 1));
                  }}
                >
                  {l.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Trinn-knappene fyller feltet med et representativt midtpunkt — juster gjerne til riktig prosent.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <BrodskalanMark category={manualCategory} sizeMm={20} showText />
            </div>

            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={() => saveManual.mutate()} disabled={busy || !manualDirty}>
                  {saveManual.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Lagre manuell grovhet
                </Button>
              </div>
            )}
          </SourceColumn>
        </div>

        {calcCategory && manualCategory && calcCategory !== manualCategory && (
          <DiffNote>
            Beregningen gir trinn {GRAIN_LEVELS.findIndex((l) => l.key === calcCategory) + 1} ({fmtPct(grainPct)}),
            manuell gir trinn {GRAIN_LEVELS.findIndex((l) => l.key === manualCategory) + 1} ({fmtPct(manualParsed)}).
          </DiffNote>
        )}

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="flex items-center gap-1.5">
                {claimLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                Merk produktet med Brødskala'n-merket
              </Label>
              <p className="text-xs text-muted-foreground">
                {claimLocked
                  ? "Låst til det finnes en effektiv grovhet — beregn merkedata eller legg inn manuell prosent."
                  : `Merket som trykkes: ${brodskalanFor(effectiveCategory)?.label ?? "—"} (${fmtPct(effectivePct)}).`}
              </p>
            </div>
            <Switch
              checked={claimGrain}
              disabled={!canWrite || savingClaim || (claimLocked && !claimGrain)}
              onCheckedChange={onToggleClaim}
            />
          </div>
          {claimGrain && approvedAt && (
            <p className="text-xs text-muted-foreground">
              Sist godkjent {formatDateTimeNb(approvedAt)}
              {approverName ? ` av ${approverName}` : ""}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
