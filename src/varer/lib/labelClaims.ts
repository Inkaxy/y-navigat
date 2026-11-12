/**
 * Når merkebryterne (Brødskala'n og Nøkkelhullet) er låst. Reglene er de
 * samme som `GrainSection` og `KeyholeSection` har brukt — samlet her slik at
 * merkeradene og detaljseksjonene ikke kan drive fra hverandre.
 */

export interface GrainClaimInput {
  breadscaleMode: "auto" | "manual";
  manualPct: number | null;
  grainPct: number | null;
  freeTextGrainLineCount?: number;
}

export function grainClaimState(i: GrainClaimInput): { effectivePct: number | null; locked: boolean; reason: string | null } {
  const effectivePct = i.breadscaleMode === "manual" ? i.manualPct : i.grainPct;
  const locked = effectivePct == null || (i.freeTextGrainLineCount ?? 0) > 0;
  return {
    effectivePct,
    locked,
    reason: locked ? "Låst til det finnes en effektiv grovhet — beregn merkedata eller legg inn manuell prosent." : null,
  };
}

export function keyholeClaimState(i: { coverageOk: boolean; status: string | null | undefined }): { locked: boolean; reason: string | null } {
  const locked = !i.coverageOk || i.status !== "oppfylt";
  return { locked, reason: locked ? "Låst til alle kriteriene er oppfylt med tilstrekkelig datadekning." : null };
}
