// Ren logikk for «Rett fakturert enhet»: bare `unit` sendes til rm_correct_invoice_line. Ingen tall endres.
import { CONTAINER_OPTIONS, CONTENT_UNITS } from "@/fakturaer/lib/packageSpec";

export function unitCorrectionOptions(current: string | null): string[] {
  const all = [...CONTAINER_OPTIONS, ...CONTENT_UNITS.filter((u) => u !== "stk")];
  const cur = (current ?? "").trim().toLowerCase();
  return all.filter((u, i) => all.indexOf(u) === i && u !== cur);
}

export type UnitCorrectionState =
  | { kind: "ready"; after: string }
  | { kind: "blocked"; reason: string };

export function unitCorrectionState(i: { before: string | null; after: string; reason: string; costPosted: boolean; loading: boolean; loadError: boolean; unknown: boolean }): UnitCorrectionState {
  if (i.unknown) return { kind: "blocked", reason: "Forrige forsøk har ukjent utfall. Les inn linjen på nytt først." };
  if (i.loading) return { kind: "blocked", reason: "Henter linjens gjeldende versjon …" };
  if (i.loadError || i.before == null) return { kind: "blocked", reason: "Linjens gjeldende versjon er ukjent." };
  if (i.costPosted) return { kind: "blocked", reason: "Kostpris er ført for linjen. Enheten kan ikke rettes." };
  const after = i.after.trim().toLowerCase();
  if (!after) return { kind: "blocked", reason: "Velg riktig enhet." };
  if (after === i.before.trim().toLowerCase()) return { kind: "blocked", reason: "Enheten er den samme som før." };
  if (i.reason.trim().length < 3) return { kind: "blocked", reason: "Skriv en begrunnelse." };
  return { kind: "ready", after };
}
