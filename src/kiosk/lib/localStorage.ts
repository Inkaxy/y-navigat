// Type-safe wrappers rundt window.localStorage for Kiosk.
// Operator-state nøklene scopes per terminal_id slik at flere
// terminaler på samme device (utviklingstesting) ikke kolliderer.

export function operatorStorageKey(terminalId: string) {
  return `kiosk-${terminalId}-operator`;
}

export function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function clearKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
