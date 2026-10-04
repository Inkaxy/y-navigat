import { supabase } from "@/integrations/supabase/client";
import { acceptMatch, type AcceptMatchResult } from "@/fakturaer/lib/acceptMatch";
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
  /** Linjer der valget er lagret, men varenummeret ikke kunne læres. */
  learningFailed: number;
  /** Lagret, men prisberegningen gjenstår (ny matching feilet). */
  recalcPending: number;
  /** Linjer som var endret siden brukeren så listen, og derfor ikke ble lagret. */
  changedSinceViewed: number;
}

export function summarize(outcomes: LineOutcome[], extra: Partial<Pick<GroupOutcome, "learningFailed" | "recalcPending" | "changedSinceViewed">> = {}): GroupOutcome {
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  return {
    outcomes, ok, failed,
    text: failed ? `${ok} av ${outcomes.length} lagret, ${failed} feilet` : `${ok} av ${outcomes.length} lagret`,
    learningFailed: extra.learningFailed ?? 0,
    recalcPending: extra.recalcPending ?? 0,
    changedSinceViewed: extra.changedSinceViewed ?? 0,
  };
}

/** Tilleggsmeldinger som aldri skal skjules bak «lagret». */
export function outcomeNotes(r: GroupOutcome): string[] {
  const n: string[] = [];
  if (r.changedSinceViewed) n.push(`${r.changedSinceViewed} linjer var endret siden du så listen og ble ikke lagret.`);
  if (r.recalcPending) n.push(`Lagret, men beregningen gjenstår for ${r.recalcPending} linjer. Prøv «Oppdater matching» igjen.`);
  if (r.learningFailed) n.push(`Varenummeret kunne ikke huskes for ${r.learningFailed} linjer. Valget gjelder disse fakturaene, men kan bli spurt om igjen.`);
  return n;
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

/** Felter som avgjør om linjen fortsatt er samme spørsmål som brukeren så. */
export function frozenSignature(l: Pick<ReviewLineRow, "supplier_sku" | "package_size" | "package_unit" | "count_per_package" | "raw_material_id" | "quantity" | "total_amount">): string {
  return JSON.stringify([l.supplier_sku ?? null, l.package_size ?? null, l.package_unit ?? null, l.count_per_package ?? null, l.raw_material_id ?? null, l.quantity ?? null, l.total_amount ?? null]);
}

/** Henter linjene på nytt og beholder bare dem som er uendret siden visning. */
export async function filterUnchanged(lines: readonly ReviewLineRow[]): Promise<{ keep: ReviewLineRow[]; changed: number }> {
  if (!lines.length) return { keep: [], changed: 0 };
  const { data, error } = await supabase.from("invoice_lines")
    .select("id, supplier_sku, package_size, package_unit, count_per_package, raw_material_id, quantity, total_amount, invoice:invoices!inner(status)")
    .in("id", lines.map((l) => l.id));
  if (error) throw new Error("Kunne ikke kontrollere linjene før lagring");
  const fresh = new Map((data ?? []).map((r) => [r.id, r]));
  const keep = lines.filter((l) => {
    const f = fresh.get(l.id);
    if (!f) return false;
    const st = (f.invoice as { status: string | null } | null)?.status ?? "";
    if (st === "reconciled" || st === "cancelled") return false;
    return frozenSignature(f as Parameters<typeof frozenSignature>[0]) === frozenSignature(l);
  });
  return { keep, changed: lines.length - keep.length };
}

async function saveGroup(lines: readonly ReviewLineRow[], save: (l: ReviewLineRow) => Promise<AcceptMatchResult>): Promise<GroupOutcome> {
  const { keep, changed } = await filterUnchanged(lines);
  let learningFailed = 0;
  const base = await runPerLine(keep, async (l) => {
    const r = await save(l);
    if (r.learningError) learningFailed++;
  });
  const okLines = keep.filter((l) => base.outcomes.find((o) => o.lineId === l.id)?.ok);
  const failures = await rematchLines(okLines);
  const recalcPending = failures.reduce((s, f) => s + f.lineIds.length, 0);
  return summarize(base.outcomes, { learningFailed, recalcPending, changedSinceViewed: changed });
}

/** Råvarevalg: bekrefter IKKE pakning — eventuell lagret pakningsbekreftelse beholdes. */
export async function applyMaterialToLines(lines: readonly ReviewLineRow[], rawMaterialId: string): Promise<GroupOutcome> {
  const userId = await uid();
  return saveGroup(lines, (line) => acceptMatch({ line, rawMaterialId, userId, rememberSku: !!line.supplier_sku, skipRematch: true }));
}

/**
 * Pakning: beholder kjent råvare, bekrefter innhold per pakning i grunnenhet
 * på leverandørkoblingen. Gjelder bare linjer med samme varenummer og en
 * dokumentert pakning — ukjent pakning forplantes aldri.
 */
export async function applyPackageToLines(lines: readonly ReviewLineRow[], baseUnitsPerPackage: number): Promise<GroupOutcome> {
  if (!Number.isFinite(baseUnitsPerPackage) || baseUnitsPerPackage <= 0) throw new Error("Innholdet må være et positivt tall");
  const userId = await uid();
  return saveGroup(lines, (line) => {
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
}

/** Dokumentert regnestykke: mengde × innhold = grunnmengde; linjesum / grunnmengde = pris per grunnenhet. */
export function packagePreview(line: Pick<ReviewLineRow, "quantity" | "total_amount">, content: number | null) {
  const q = line.quantity == null ? null : Number(line.quantity);
  if (q == null || !Number.isFinite(q) || q <= 0 || content == null || !(content > 0)) return null;
  const base = q * content;
  const t = line.total_amount == null ? null : Number(line.total_amount);
  return { baseQuantity: base, pricePerBase: t != null && Number.isFinite(t) ? Math.round((t / base) * 100) / 100 : null };
}
