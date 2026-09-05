import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Kastes når ordren er endret av noen andre siden den ble lastet. */
export class OrderConflictError extends Error {
  constructor(message = "Ordren er endret av noen andre — last inn på nytt") {
    super(message);
    this.name = "OrderConflictError";
  }
}

export function isOrderConflict(err: unknown): err is OrderConflictError {
  return err instanceof OrderConflictError;
}

/** Alle spørringene som må oppdateres etter en ordremutasjon. */
export function invalidateOrderQueries(qc: QueryClient, orderId?: string | null): Promise<unknown> {
  const keys: unknown[][] = [
    ["orders"],
    ["orders-lifecycle"],
    ["order-status-counts"],
    ["delivery-day-status"],
    ["action-queue-counts"],
  ];
  if (orderId) {
    keys.unshift(["order", orderId]);
    keys.push(["order-events", orderId]);
  }
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/**
 * Felles håndtering av samtidighetskonflikt: én tydelig beskjed og en full
 * oppfriskning slik at brukeren ser den faktiske tilstanden.
 */
export async function handleOrderConflict(
  qc: QueryClient,
  orderId?: string | null,
): Promise<void> {
  toast.error("Ordren er endret av noen andre — last inn på nytt");
  await invalidateOrderQueries(qc, orderId);
}
