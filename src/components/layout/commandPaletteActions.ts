import { FileUp, Plus, ScanSearch, Wheat, type LucideIcon } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";

export interface PaletteAction { to: string; label: string; icon: LucideIcon }

/** Råvarer-gruppen i ⌘K. Fakturahandlinger krever fakturatilgang, «Ny råvare» skrivetilgang. */
export function buildRavarerActions(a: { canRead: boolean; canWrite: boolean; hasInvoiceAccess: boolean }): PaletteAction[] {
  if (!a.canRead) return [];
  const out: PaletteAction[] = [];
  if (a.canWrite) out.push({ to: paths.varer({ ny: "1" }), label: "Ny råvare", icon: Plus });
  if (a.hasInvoiceAccess) {
    out.push({ to: paths.importFaktura(), label: "Importer faktura", icon: FileUp });
    out.push({ to: paths.priskontroll(), label: "Åpne priskontroll", icon: ScanSearch });
  }
  out.push({ to: paths.varer(), label: "Åpne vareliste", icon: Wheat });
  return out;
}
