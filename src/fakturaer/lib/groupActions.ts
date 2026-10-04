import { supabase } from "@/integrations/supabase/client";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";
import { rematchLines } from "@/fakturaer/lib/queueActions";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

export interface LineOutcome {
  lineId: string;
  invoiceNumber: string;
  ok: boolean;
  message: string | null;
}

export interface GroupOutcome {
  outcomes: LineOutcome[];
  ok: number;
  failed: number;
  /** Ærlig tekst: «3 av 3 lagret» eller «2 av 3 lagret, 1 feilet». */
  text: string;
}

export function summarize(outcomes: LineOutcome[]): GroupOutcome {
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  return { outcomes, ok, failed, text: failed ? `${ok} av ${outcomes.length} lagret, ${failed} feilet` : `${ok} av ${outcomes.length} lagret` };
}

/** Kjører én servervalidert lagring per linje og rapporterer nøyaktig resultat. */
export async function runPerLine(lines: readonly ReviewLineRow[], save: (l: ReviewLineRow) => Promise<unknown>): Promise<GroupOutcome> {
  const outcomes: LineOutcome[] = [];
  for (const l of lines) {
    try {
      await save(l);
      outcomes.push({ lineId: l.id, invoiceNumber: l.invoice.invoice_number, ok: true, message: null });
    } catch (e) {
      outcomes.push({ lineId: l.id, invoiceNumber: l.invoice.invoice_number, ok: false, message: e instanceof Error ? e.message : "Ukjent feil" });
    }
  }
  return summarize(outcomes);
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Ikke innlogget");
  return data.user.id;
}

/** Råvarevalg: bekrefter IKKE pakning — eventuell lagret pakningsbekreftelse beholdes. */
export async function applyMaterialToLines(lines: readonly ReviewLineRow[], rawMaterialId: string): Promise<GroupOutcome> {
  const userId = await uid();
  const res = await runPerLine(lines, (line) =>
    acceptMatch({ line, rawMaterialId, userId, rememberSku: !!line.supplier_sku, skipRematch: true }),
  );
  await rematchLines(lines.filter((l) => res.outcomes.find((o) => o.lineId === l.id)?.ok));
  return res;
}

/**
 * Pakning: beholder kjent råvare, bekrefter innhold per pakning i grunnenhet
 * på leverandørkoblingen. Gjelder bare linjer med samme varenummer og pakning.
 */
export async function applyPackageToLines(lines: readonly ReviewLineRow[], baseUnitsPerPackage: number): Promise<GroupOutcome> {
  if (!Number.isFinite(baseUnitsPerPackage) || baseUnitsPerPackage <= 0) throw new Error("Innholdet må være et positivt tall");
  const userId = await uid();
  const res = await runPerLine(lines, (line) => {
    if (!line.raw_material_id) throw new Error("Linjen mangler råvare");
    return acceptMatch({
      line,
      rawMaterialId: line.raw_material_id,
      userId,
      packageSize: line.package_size,
      packageUnit: line.package_unit,
      baseUnitsPerPackage,
      confirmPackage: true,
      rememberSku: !!line.supplier_sku,
      skipRematch: true,
    });
  });
  await rematchLines(lines.filter((l) => res.outcomes.find((o) => o.lineId === l.id)?.ok));
  return res;
}

/** Dokumentert regnestykke: mengde × innhold = grunnmengde; linjesum / grunnmengde = pris per grunnenhet. */
export function packagePreview(line: Pick<ReviewLineRow, "quantity" | "total_amount">, content: number | null) {
  const q = line.quantity == null ? null : Number(line.quantity);
  if (q == null || !Number.isFinite(q) || q <= 0 || content == null || !(content > 0)) return null;
  const base = q * content;
  const t = line.total_amount == null ? null : Number(line.total_amount);
  return { baseQuantity: base, pricePerBase: t != null && Number.isFinite(t) ? Math.round((t / base) * 100) / 100 : null };
}
