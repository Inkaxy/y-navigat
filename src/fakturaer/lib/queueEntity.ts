/**
 * NBhub er ett firma. Fakturainnboksen skal derfor aldri stå på «alle
 * selskaper» — da lastes verken leverandører eller toleranser.
 *
 * Vi bruker selskapet fra `useCompany` når det er tilgjengelig, og faller
 * tilbake på det ene selskapet brukeren har fakturatilgang til. Først når
 * tilgangen faktisk spenner over flere selskaper er «alle» et gyldig valg.
 */
export function resolveQueueEntityId(
  companyId: string | null | undefined,
  accessibleEntityIds: readonly string[],
): string | null {
  if (companyId && (accessibleEntityIds.length === 0 || accessibleEntityIds.includes(companyId))) {
    return companyId;
  }
  if (accessibleEntityIds.length === 1) return accessibleEntityIds[0];
  return null;
}
