// «Angre nullstilling» – så langt de underliggende angre-funksjonene tillater. Kjøres i omvendt rekkefølge (fase 2 før fase 1,
// siste steg først), slik at en godtatt pris på en ny kobling angres før koblingen.
import type { Action, Rule } from "./types";
import { RESET_LABEL } from "./types";
import { isObj } from "@/fakturaer/lib/parseRpcJson";

export type UndoOutcome = { status: "angret" | "delvis" | "kan_ikke"; result: Record<string, unknown>; message: string } | { status: "ukjent"; message: string };

/** Hva som ikke kan angres – vises før Henrik bekrefter. */
export const UNDO_LIMITS: Record<Action, string | null> = {
  ikke_vare: null,
  godta_pris: "Prisen åpnes som spørsmål igjen. Linjer på fakturaer som er avstemt, godkjent eller har ført kostpris i mellomtiden, kan ikke angres.",
  bekreft_pakning: "Kan ikke angres herfra: linjene var koblet før kjøringen, og angring av kobling ville gjort dem ukoblet. Pakningsbekreftelsen står – rett den på leverandørvaren om nødvendig.",
  koble: "Linjene blir ukoblede spørsmål igjen. Skrivemåter som ble husket for leverandørvaren, står.",
  opprett: "Linjene blir ukoblede spørsmål igjen, og den nye varen settes inaktiv hvis den ikke er brukt (den slettes aldri).",
  hold_utenfor: "Linjen åpnes igjen som ukoblet spørsmål («gjenåpnet») – også om den var koblet før. Koblingen gjenopprettes ikke automatisk.",
};
export const canUndoAction = (a: Action) => a !== "bekreft_pakning";

export const undoReason = (rule: Rule, runId: string, itemId: string) => `Angret ${RESET_LABEL.toLowerCase()} – regel ${rule} · kjøring ${runId.slice(0, 8)} · steg ${itemId}`;

/** Tolker svaret fra de eksisterende angre-funksjonene ({ ok, undone: [...], skipped: [...] }). */
export function classifyUndo(data: unknown, wanted: number): UndoOutcome {
  if (!isObj(data)) return { status: "ukjent", message: "Uleselig svar." };
  const d = data;
  if (d.ok !== true || !Array.isArray(d.undone)) return { status: "ukjent", message: "Uleselig svar." };
  const undone = d.undone.length;
  const skipped = Array.isArray(d.skipped) ? d.skipped : [];
  const result = { undone, skipped: skipped.length };
  if (undone === 0) return { status: "kan_ikke", result, message: "Ingenting kunne angres (låst, endret eller allerede åpen)." };
  if (undone < wanted) return { status: "delvis", result, message: `${undone} av ${wanted} linjer angret.` };
  return { status: "angret", result, message: `${undone} ${undone === 1 ? "linje" : "linjer"} angret.` };
}
