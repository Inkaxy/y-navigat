import { createContext, useContext, type ReactNode } from "react";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";
import { UNCHECKED } from "@/fakturaer/lib/priceSafety";
import type { GateFor, SafetyLineRef } from "@/fakturaer/hooks/useInvoicePriceSafety";

/** Uten provider er prisstatusen ukjent — aldri godkjent. */
const Ctx = createContext<GateFor>(() => UNCHECKED);

export function PriceGateProvider({ gateFor, children }: { gateFor: GateFor; children: ReactNode }) {
  return <Ctx.Provider value={gateFor}>{children}</Ctx.Provider>;
}

export function usePriceGate(line: SafetyLineRef): PriceGate {
  return useContext(Ctx)(line);
}
