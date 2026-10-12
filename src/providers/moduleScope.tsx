import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * Rent presentasjonelt modul-omfang: setter `data-active-app` på <html> slik at portalerte dialoger
 * og innhold arver modulens semantiske fargeregler (index.css). Ingen henting, ingen tilgang.
 *
 * Eierskap: hver instans registrerer et eget token med dybde (nestede scoper vinner over ytre, uavhengig
 * av effekt-rekkefølge). Ved avmontering fjernes bare eget token, og attributtet settes til
 * gjenværende eier med størst dybde (sist registrert ved lik dybde) — eller fjernes.
 */
type Claim = { token: number; code: string; depth: number };
let seq = 0;
const claims: Claim[] = [];
const ATTR = "data-active-app";

function apply() {
  const root = document.documentElement;
  let top: Claim | null = null;
  for (const c of claims) if (!top || c.depth > top.depth || (c.depth === top.depth && c.token > top.token)) top = c;
  if (top) root.setAttribute(ATTR, top.code);
  else root.removeAttribute(ATTR);
}

export function claimActiveApp(code: string, depth: number): () => void {
  const claim: Claim = { token: ++seq, code, depth };
  claims.push(claim);
  apply();
  return () => {
    const i = claims.indexOf(claim);
    if (i >= 0) claims.splice(i, 1);
    apply();
  };
}

/** Bare for tester. */
export function __resetModuleScope() { claims.length = 0; apply(); }

const DepthCtx = createContext(0);

/** Presentasjonelt omfang for én modul. Brukes av AppColorProvider og av inerte forhåndsvisninger. */
export function ModuleScope({ appCode, children }: { appCode: string; children: ReactNode }) {
  const depth = useContext(DepthCtx) + 1;
  useEffect(() => claimActiveApp(appCode, depth), [appCode, depth]);
  return <DepthCtx.Provider value={depth}>{children}</DepthCtx.Provider>;
}
