/**
 * Resultatlinjer etter «Ikke vare» på én linje. Angre setter bare linjen
 * tilbake; regelen for fremtidige fakturaer slettes ikke, og det sies tydelig.
 */
export function notItemResultItems(description: string | null, patternId: string | null): string[] {
  return [
    ...(description ? [description] : []),
    ...(patternId ? ["Regelen for fremtidige fakturaer beholdes også om du angrer"] : []),
  ];
}
