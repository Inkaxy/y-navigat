// Vellykket nøkkeltest for fakturalesing etterlater ingen spor på serveren (ai-config-test logger
// ikke til bruksloggen). Vi husker derfor tidspunktet lokalt i nettleseren, bare for å vise
// «Nøkkelen er testet og virker, venter på første lesing» i stedet for at stillstandsvarselet blir stående.
// Det er aldri bevis på at lesingen virker: første vellykkede lesing fjerner varselet helt.
const KEY = "nbhub:ai-key-test-ok:invoice_extraction";

export function saveKeyTestOk(at: string = new Date().toISOString()): void {
  try { window.localStorage.setItem(KEY, at); } catch { /* privat modus: varselet faller tilbake til stillstand */ }
}

export function loadKeyTestOk(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}
