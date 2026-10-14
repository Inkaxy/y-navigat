// Kvittering etter lagring på varekortet: bare FERSK serverstatus avgjør om kortet er ferdig.
// Metadata-suksess (koblet/pakning lagret) betyr ikke at varekortet er behandlet.
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";

export type FreshStatus =
  | { kind: "pending" }
  | { kind: "unknown" }
  | { kind: "ok"; remaining: number; invoices: { invoiceId: string; invoiceNumber: string | null; lineId: string; open: number }[] };

/** Gjenstående åpne linjer fra en fersk henting. Feil/manglende data = ukjent, aldri 0. */
export function freshStatusFrom(res: { isError: boolean; data: SupplierItemLine[] | undefined }): FreshStatus {
  if (res.isError || !res.data) return { kind: "unknown" };
  const open = res.data.filter((l) => l.requires_review);
  const by = new Map<string, { invoiceId: string; invoiceNumber: string | null; lineId: string; open: number }>();
  for (const l of open) {
    const cur = by.get(l.invoice_id);
    if (cur) cur.open += 1;
    else by.set(l.invoice_id, { invoiceId: l.invoice_id, invoiceNumber: l.invoice_number ?? null, lineId: l.id, open: 1 });
  }
  return { kind: "ok", remaining: open.length, invoices: [...by.values()] };
}

/** Kortet flyttes til «behandlet» bare ved bekreftet 0 åpne. */
export const cardFinished = (s: FreshStatus): boolean => s.kind === "ok" && s.remaining === 0;
