import type { TripletexCredentialRow } from "@/ravarer/hooks/useTripletex";

export type TripletexMode = "jwt" | "standard" | "private";
export interface TripletexNonSecret { mode: TripletexMode; syncEnabled: boolean; frequency: number }
export interface TripletexTokens { jwt: string; consumer: string; employee: string }

export const baselineOf = (cred: TripletexCredentialRow | null): TripletexNonSecret =>
  cred ? { mode: cred.mode, syncEnabled: cred.sync_enabled, frequency: cred.sync_frequency_minutes } : { mode: "jwt", syncEnabled: false, frequency: 60 };

export const sameNonSecret = (a: TripletexNonSecret, b: TripletexNonSecret) => a.mode === b.mode && a.syncEnabled === b.syncEnabled && a.frequency === b.frequency;

const has = (s: string) => s.trim().length > 0;

/**
 * Hvorfor lagring ikke kan sendes (serverens regler i `tripletex-save-credentials`), eller null.
 * Lagret nøkkel beholdes bare når modusen er den samme; modusbytte og første oppsett krever ny nøkkel.
 */
export function tripletexSaveBlock(cred: TripletexCredentialRow | null, d: TripletexNonSecret, t: TripletexTokens): string | null {
  const newSecret = d.mode === "jwt" ? has(t.jwt) : has(t.employee);
  if (!cred && !newSecret) return d.mode === "jwt" ? "Lim inn API-nøkkelen for å lagre første oppsett." : "Lim inn employee token for å lagre første oppsett.";
  if (cred && cred.mode !== d.mode && !newSecret) return "Ved bytte av modus må du lime inn en ny nøkkel for den nye modusen. Lagrede nøkler følger ikke med over til en annen modus.";
  if (d.mode === "standard" && !has(t.consumer)) {
    if (cred?.has_consumer_token === null) return "Vi kunne ikke lese om consumer token er lagret. Lim inn consumer token, eller last siden på nytt.";
    if (!(cred?.mode === "standard" && cred.has_consumer_token === true) && !cred?.has_consumer_token) return "Standardmodus krever consumer token.";
  }
  return null;
}

/** Nøyaktig nyttelast. Tomme felt utelates (= behold lagret i samme modus); automatikk sendes alltid. */
export function tripletexSavePayload(entity: string, d: TripletexNonSecret, t: TripletexTokens) {
  return {
    legal_entity_id: entity,
    mode: d.mode,
    jwt_token: d.mode === "jwt" && has(t.jwt) ? t.jwt.trim() : undefined,
    consumer_token: d.mode === "standard" && has(t.consumer) ? t.consumer.trim() : undefined,
    employee_token: d.mode !== "jwt" && has(t.employee) ? t.employee.trim() : undefined,
    sync_enabled: d.syncEnabled,
    sync_frequency_minutes: d.frequency,
  };
}

/** Serverens eneste suksesssvar er nøyaktig `{ ok: true }`. Alt annet (null, {}, feil) er ikke «lagret». */
export function isTripletexSaved(data: unknown): boolean {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "ok" in data && data.ok === true && !("error" in data && data.error);
}
