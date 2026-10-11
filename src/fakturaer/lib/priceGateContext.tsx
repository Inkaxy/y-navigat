import { createContext, useContext, type ReactNode } from "react";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { linePriceGate, type GateInvoice, type GateLine, type HoldState, type PriceGate } from "@/fakturaer/lib/financialPresentation";

type GateFn = (line: ReviewLineRow) => PriceGate;

/**
 * Uten leverandør: fakturakonteksten fra selve raden. Holdt-status er ikke lesbar for
 * klienten utenfor arbeidsflaten; serverens godta-RPC vokter fortsatt mot holdte priser.
 */
const fallback: GateFn = (line) => linePriceGate(line.invoice, line, false);
const Ctx = createContext<GateFn>(fallback);

export function PriceGateProvider({ invoice, linesById, heldFor, children }: {
  invoice: GateInvoice;
  /** Fulle linjer (med lesevarsler) fra fakturadetaljen. */
  linesById: Map<string, GateLine>;
  heldFor: (line: { id: string; supplier_sku?: string | null; description?: string | null; requires_review?: boolean | null }) => HoldState;
  children: ReactNode;
}) {
  const fn: GateFn = (line) => linePriceGate(invoice, { ...line, ...(linesById.get(line.id) ?? {}) }, heldFor(line));
  return <Ctx.Provider value={fn}>{children}</Ctx.Provider>;
}

export function usePriceGate(line: ReviewLineRow): PriceGate {
  return useContext(Ctx)(line);
}
