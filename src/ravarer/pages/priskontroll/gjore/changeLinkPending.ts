/**
 * Uavklarte koblingsflytt per leverandørkobling (`rms_id`). Lever utenfor dialogen, så lukk/åpne
 * aldri frigjør et nytt forsøk. Bare et eksplisitt «kontrollert»-valg etter ny lesing frigjør.
 */
const pending = new Map<string, { newRawMaterialId: string; at: string }>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
export const rememberChangeLinkUnknown = (rmsId: string, newRawMaterialId: string) => { pending.set(rmsId, { newRawMaterialId, at: new Date().toISOString() }); emit(); };
export const changeLinkUnknownFor = (rmsId: string | null | undefined) => (rmsId ? pending.get(rmsId) ?? null : null);
export const clearChangeLinkUnknown = (rmsId: string) => { pending.delete(rmsId); emit(); };
export const subscribeChangeLinkUnknown = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const resetChangeLinkUnknownForTest = () => { pending.clear(); emit(); };
