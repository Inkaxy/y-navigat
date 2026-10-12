import { createContext, useContext, useEffect, type ReactNode } from "react";
import { claimActiveApp } from "@/providers/moduleScopeStore";

const DepthCtx = createContext(0);

/** Presentasjonelt omfang for én modul. Brukes av AppColorProvider og av inerte forhåndsvisninger. */
export function ModuleScope({ appCode, children }: { appCode: string; children: ReactNode }) {
  const depth = useContext(DepthCtx) + 1;
  useEffect(() => claimActiveApp(appCode, depth), [appCode, depth]);
  return <DepthCtx.Provider value={depth}>{children}</DepthCtx.Provider>;
}
