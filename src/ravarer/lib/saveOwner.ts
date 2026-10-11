import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Eierskap til Cmd/Ctrl-S på råvarekortet. En seksjon registrerer lagring med nøkkelen som gjaldt da
 * den ble montert (råvare + seksjon). Lagring kalles bare når registrert nøkkel = gjeldende nøkkel;
 * nøkkelen endres først når URL-en faktisk har endret seg (blokkert navigasjon endrer den ikke).
 * Ved nøkkelbytte frigis den gamle registreringen, så en avmontert seksjon aldri kan lagres.
 */
export function createSaveOwner() {
  let current: { key: string; fn: () => void } | null = null;
  return {
    register(key: string, fn: () => void) { current = { key, fn }; },
    release(key: string) { if (current?.key === key) current = null; },
    save(key: string): boolean {
      if (!current || current.key !== key) return false;
      current.fn();
      return true;
    },
    ownerKey: () => current?.key ?? null,
  };
}

export function useSaveOwner(key: string) {
  const ref = useRef(createSaveOwner());
  const keyRef = useRef(key);
  keyRef.current = key;
  // Frigi forrige nøkkels lagring når nøkkelen faktisk endres (eller kortet avmonteres).
  useEffect(() => () => ref.current.release(key), [key]);
  const register = useCallback((fn: () => void) => ref.current.register(key, fn), [key]);
  return useMemo(() => ({ register, save: () => ref.current.save(keyRef.current), ownerKey: () => ref.current.ownerKey() }), [register]);
}
