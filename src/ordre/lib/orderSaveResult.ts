/**
 * Validering av svaret fra `order_save_with_lines`.
 *
 * RPC-en er den eneste skrivepunktet for ordrehode + linjer. Et tomt eller
 * uventet svar må derfor behandles som en feil — ikke som stille suksess.
 */
export interface OrderSaveResult {
  updated: number;
  inserted: number;
  deleted: number;
  lineIds: string[];
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

export function parseOrderSaveResult(data: unknown): OrderSaveResult {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Lagringen ga ikke noe svar fra serveren. Ordren kan være uendret — prøv igjen.");
  }
  const raw = data as Record<string, unknown>;
  if (!isFiniteInt(raw.updated) || !isFiniteInt(raw.inserted) || !isFiniteInt(raw.deleted)) {
    throw new Error("Serveren svarte uventet på lagringen. Kontroller ordren før du prøver igjen.");
  }
  if (!Array.isArray(raw.line_ids)) {
    throw new Error("Serveren svarte uventet på lagringen. Kontroller ordren før du prøver igjen.");
  }
  const lineIds: string[] = [];
  for (const entry of raw.line_ids) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Serveren svarte uventet på lagringen. Kontroller ordren før du prøver igjen.");
    }
    lineIds.push(id);
  }
  return {
    updated: raw.updated,
    inserted: raw.inserted,
    deleted: raw.deleted,
    lineIds,
  };
}

/**
 * En linje-id klienten mener finnes, men som ikke ligger på ordren, skal ALDRI
 * bli til en ny linje i stillhet — da ville en samtidig sletting/endring gitt
 * dobbeltføring.
 */
export function resolveExistingLineId(
  clientId: string | null | undefined,
  existingIds: ReadonlySet<string>,
): string | null {
  if (!clientId) return null;
  if (!existingIds.has(clientId)) {
    throw new Error(
      "Ordren er endret av noen andre mens du redigerte. Lukk og åpne ordren på nytt før du lagrer.",
    );
  }
  return clientId;
}
