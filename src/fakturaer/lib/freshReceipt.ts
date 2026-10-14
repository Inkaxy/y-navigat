// Kvittering etter lagring på varekortet: bare FERSK, autoritativ serverstatus avgjør om kortet er ferdig.
// Metadata-suksess (koblet/pakning lagret) betyr ikke at varekortet er behandlet.
import type { SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

/** Linjehentingens tak (`rm_supplier_item_lines` p_limit). Et fullt utvalg kan være avkortet. */
export const ITEM_LINES_LIMIT = 200;

export type FreshStatus =
  | { kind: "pending" }
  | { kind: "unknown" }
  | { kind: "ok"; remaining: number; complete: boolean; invoices: { invoiceId: string; invoiceNumber: string | null; lineId: string; open: number }[] };

export interface FreshInput {
  /** Fersk henting av nøyaktig varekort (pageSize 1). */
  item: { isError: boolean; data: { items: SupplierItem[] } | undefined };
  /** Fersk linjekontekst (kun for lenker – aldri for antallet). */
  lines: { isError: boolean; data: SupplierItemLine[] | undefined };
  supplierId: string;
  itemKey: string;
}

/**
 * Gjenstående åpne linjer = serverens `open_lines` for nøyaktig samme leverandør+varenøkkel.
 * Feil, manglende/annet varekort eller ugyldig tall = ukjent, aldri 0. Linjeutvalget brukes bare til
 * lenker; et avkortet utvalg eller linjer med ukjent `requires_review` gir `complete=false`.
 */
export function freshStatusFrom(r: FreshInput): FreshStatus {
  if (r.item.isError || !r.item.data) return { kind: "unknown" };
  const items = r.item.data.items;
  if (items.length !== 1) return { kind: "unknown" };
  const it = items[0];
  if (it.supplier_id !== r.supplierId || it.item_key !== r.itemKey) return { kind: "unknown" };
  const remaining = it.open_lines;
  if (typeof remaining !== "number" || !Number.isInteger(remaining) || remaining < 0) return { kind: "unknown" };
  const linesOk = !r.lines.isError && Array.isArray(r.lines.data);
  const data = linesOk ? (r.lines.data as SupplierItemLine[]) : [];
  const reviewUnknown = data.some((l) => typeof l.requires_review !== "boolean");
  const open = data.filter((l) => l.requires_review === true);
  // Server sier åpne linjer finnes, men utvalget viser ingen: lenkene er ufullstendige, ikke «ferdig».
  const complete = linesOk && !reviewUnknown && data.length < ITEM_LINES_LIMIT && open.length === remaining;
  const by = new Map<string, { invoiceId: string; invoiceNumber: string | null; lineId: string; open: number }>();
  for (const l of open) {
    const cur = by.get(l.invoice_id);
    if (cur) cur.open += 1;
    else by.set(l.invoice_id, { invoiceId: l.invoice_id, invoiceNumber: l.invoice_number ?? null, lineId: l.id, open: 1 });
  }
  return { kind: "ok", remaining, complete, invoices: [...by.values()] };
}

/** Kortet flyttes til «behandlet» bare ved bekreftet 0 åpne fra serveren. */
export const cardFinished = (s: FreshStatus): boolean => s.kind === "ok" && s.remaining === 0;
