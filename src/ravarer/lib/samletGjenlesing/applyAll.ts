// «Bruk alle» i «Forslag venter på deg»: ren logikk (testes). Hvert forslag vurderes med samme regel som «Bruk»
// på én rad (decideAuto) og sendes med nøyaktig de operasjonene regelen tillater. Beskyttede linjer røres aldri.
import type { Operation } from "@/fakturaer/lib/reread";
import type { AutoDecision } from "./rule";

/** stemmer = summen stemmer etterpå · stemmer_ikke = noe kan brukes, men summen stemmer fortsatt ikke ·
 *  ingenting = ingenting kan brukes uten egne valg · utilgjengelig = ikke klart lenger eller kunne ikke tolkes. */
export type ApplyAllClass = "stemmer" | "stemmer_ikke" | "ingenting" | "utilgjengelig";

export type ApplyAllItem = { runId: string; invoiceId: string; cls: ApplyAllClass; operations: Operation[] };

export function classifyForApplyAll(d: AutoDecision | null): { cls: ApplyAllClass; operations: Operation[] } {
  if (!d) return { cls: "utilgjengelig", operations: [] };
  if ((d.kind === "bruk" || d.kind === "forslag") && d.operations.length > 0) {
    return { cls: d.after.lines_sum_status === "ok" ? "stemmer" : "stemmer_ikke", operations: d.operations };
  }
  return { cls: "ingenting", operations: [] };
}

export type ApplyAllSummary = Record<ApplyAllClass, number>;
export function summarizeApplyAll(items: ApplyAllItem[]): ApplyAllSummary {
  const s: ApplyAllSummary = { stemmer: 0, stemmer_ikke: 0, ingenting: 0, utilgjengelig: 0 };
  for (const i of items) s[i.cls]++;
  return s;
}

/** Hvilke forslag som sendes. «Ingenting» og «utilgjengelig» sendes aldri. */
export function selectForApplyAll(items: ApplyAllItem[], includeMismatch: boolean): ApplyAllItem[] {
  return items.filter((i) => i.operations.length > 0 && (i.cls === "stemmer" || (includeMismatch && i.cls === "stemmer_ikke")));
}

export type ApplyAllTally = { applied: number; rejected: number; alreadyUsed: number; unknown: number; notStarted: number };
const n = (v: number) => v.toLocaleString("nb-NO");

/** Kvittering. Bare bekreftet lagrede forslag telles som brukt. */
export function applyAllMessage(t: ApplyAllTally): { ok: boolean; text: string } {
  const parts: string[] = [];
  parts.push(t.applied === 1 ? "1 forslag er tatt i bruk." : `${n(t.applied)} forslag er tatt i bruk.`);
  if (t.rejected > 0) parts.push(`${n(t.rejected)} kunne ikke brukes – åpne dem for å se hvorfor.`);
  if (t.alreadyUsed > 0) parts.push(`${n(t.alreadyUsed)} var allerede tatt i bruk med andre valg.`);
  if (t.unknown > 0) parts.push(`${n(t.unknown)} har ukjent utfall – åpne forslaget og kontroller før du prøver igjen.`);
  if (t.notStarted > 0) parts.push(`${n(t.notStarted)} ble ikke sendt og venter fortsatt.`);
  return { ok: t.rejected === 0 && t.alreadyUsed === 0 && t.unknown === 0 && t.notStarted === 0 && t.applied > 0, text: parts.join(" ") };
}
