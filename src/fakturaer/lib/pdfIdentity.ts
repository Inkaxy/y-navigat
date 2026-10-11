/** Identitet for et originaldokument: lagringssti + kjent versjon + innholdsavtrykk. */
export const documentIdentity = (cacheKey: string, version: string | null | undefined, fingerprint: string) => `${cacheKey}|${version ?? ""}|${fingerprint}`;
