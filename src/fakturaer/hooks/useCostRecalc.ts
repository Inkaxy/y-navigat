/**
 * Reberegning av kostpriser fra fakturalinjer som allerede ligger i basen.
 *
 * Beregningen er det SAMME `resolveLineCost`-kallet som matchingen bruker —
 * ingen egen variant. Historikk (`knownPricePerBaseUnit`) sendes bevisst IKKE
 * inn: de registrerte prisene er nettopp det vi mistenker er feil, og skal
 * derfor ikke få lov til å styre valget av tolkning.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { resolveLineCost, type CostBasis, type ResolveLineCostResult } from "@/fakturaer/lib/units";

const LINE_PAGE_SIZE = 500;
const APPLY_CHUNK = 10;

/** Fakturastatuser som regnes som pålitelige nok til å gi kostpris. */
const USABLE_STATUSES = ["ready", "reconciled"] as const;

/** Vanlige pakningsfaktorer — signaturen til «delt på pakningen én gang for mye». */
const COMMON_FACTORS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 24, 25, 30, 36, 40, 48, 50, 100];

export type RecalcBucket = "rettes" | "bekreft" | "uendret" | "umulig";

export interface RecalcLineUpdate {
  lineId: string;
  pricePerBaseUnit: number;
  baseQuantity: number;
}

export interface RecalcRow {
  rawMaterialId: string;
  name: string;
  sku: string | null;
  baseUnit: string;
  currentPrice: number | null;
  proposedPrice: number | null;
  changePct: number | null;
  /** Satt når endringen ligger nær en hel pakningsfaktor (25×, 20×, 12× …). */
  packageFactor: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierId: string | null;
  explanation: string;
  basis: CostBasis | null;
  confidence: number;
  confidenceLevel: ResolveLineCostResult["confidenceLevel"];
  needsInput: ResolveLineCostResult["needsInput"];
  reason: string | null;
  bucket: RecalcBucket;
  /** Alle linjer for varen som lot seg beregne — oppdateres sammen med kostprisen. */
  lineUpdates: RecalcLineUpdate[];
  lineCount: number;
}

export interface RecalcProgress {
  phase: "idle" | "laster" | "beregner" | "skriver" | "ferdig" | "avbrutt";
  done: number;
  total: number;
  label: string;
}

export interface RecalcReceipt {
  updatedMaterials: number;
  updatedLines: number;
  avgChangePct: number | null;
  biggestUp: RecalcRow | null;
  biggestDown: RecalcRow | null;
  stillBlocked: number;
  statsRefreshed: boolean;
}

interface LineRow {
  id: string;
  invoice_id: string;
  raw_material_id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  invoices: {
    invoice_number: string | null;
    invoice_date: string | null;
    supplier_id: string | null;
  } | null;
}

interface MaterialRow {
  id: string;
  name: string;
  sku: string | null;
  base_unit: string;
  current_cost_price: number | null;
  base_units_per_package: number | null;
  package_size: number | null;
  package_unit: string | null;
}

interface SupplierLinkRow {
  raw_material_id: string;
  supplier_id: string;
  base_units_per_package: number | null;
  package_size: number | null;
  package_unit: string | null;
  package_confirmed_at: string | null;
}

function nearFactor(ratio: number): number | null {
  const r = ratio < 1 ? 1 / ratio : ratio;
  for (const f of COMMON_FACTORS) {
    if (Math.abs(r - f) / f <= 0.04) return f;
  }
  return null;
}

const IDLE: RecalcProgress = { phase: "idle", done: 0, total: 0, label: "" };

export function useCostRecalc() {
  const { legalEntityId } = useRavarer();
  const [rows, setRows] = useState<RecalcRow[] | null>(null);
  const [progress, setProgress] = useState<RecalcProgress>(IDLE);
  const [receipt, setReceipt] = useState<RecalcReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const scan = useCallback(async () => {
    if (!legalEntityId) return;
    cancelRef.current = false;
    setError(null);
    setReceipt(null);
    setRows(null);
    setProgress({ phase: "laster", done: 0, total: 0, label: "Henter råvarer …" });

    try {
      const [matRes, linkRes] = await Promise.all([
        supabase
          .from("raw_materials")
          .select("id, name, sku, base_unit, current_cost_price, base_units_per_package, package_size, package_unit")
          .eq("legal_entity_id", legalEntityId)
          .eq("is_active", true),
        supabase
          .from("raw_material_suppliers")
          .select("raw_material_id, supplier_id, base_units_per_package, package_size, package_unit, package_confirmed_at"),
      ]);
      if (matRes.error) throw new Error(matRes.error.message);
      if (linkRes.error) throw new Error(linkRes.error.message);

      const materials = new Map<string, MaterialRow>(
        ((matRes.data ?? []) as MaterialRow[]).map((m) => [m.id, m]),
      );
      const links = new Map<string, SupplierLinkRow>(
        ((linkRes.data ?? []) as SupplierLinkRow[]).map((l) => [`${l.raw_material_id}|${l.supplier_id}`, l]),
      );

      // Fakturalinjer i porsjoner, med synlig framdrift.
      const lines: LineRow[] = [];
      let from = 0;
      let total = 0;
      for (;;) {
        if (cancelRef.current) {
          setProgress({ phase: "avbrutt", done: lines.length, total, label: "Avbrutt" });
          return;
        }
        const { data, error: err, count } = await supabase
          .from("invoice_lines")
          .select(
            "id, invoice_id, raw_material_id, description, quantity, unit, unit_price, total_amount, package_size, package_unit, count_per_package, invoices!inner(invoice_number, invoice_date, supplier_id, status, legal_entity_id)",
            { count: from === 0 ? "exact" : undefined },
          )
          .not("raw_material_id", "is", null)
          .eq("invoices.legal_entity_id", legalEntityId)
          .in("invoices.status", USABLE_STATUSES as unknown as string[])
          .order("id", { ascending: true })
          .range(from, from + LINE_PAGE_SIZE - 1);
        if (err) throw new Error(err.message);
        const page = (data ?? []) as unknown as LineRow[];
        lines.push(...page);
        if (count != null) total = count;
        setProgress({
          phase: "laster",
          done: lines.length,
          total: total || lines.length,
          label: `Henter fakturalinjer … ${lines.length}${total ? ` av ${total}` : ""}`,
        });
        if (page.length < LINE_PAGE_SIZE) break;
        from += LINE_PAGE_SIZE;
      }

      // Beregning i porsjoner slik at framdriften vises og avbrudd virker.
      interface Acc {
        material: MaterialRow;
        best: { line: LineRow; res: ResolveLineCostResult } | null;
        updates: RecalcLineUpdate[];
        blocked: ResolveLineCostResult | null;
        count: number;
      }
      const acc = new Map<string, Acc>();

      for (let i = 0; i < lines.length; i += LINE_PAGE_SIZE) {
        if (cancelRef.current) {
          setProgress({ phase: "avbrutt", done: i, total: lines.length, label: "Avbrutt" });
          return;
        }
        for (const line of lines.slice(i, i + LINE_PAGE_SIZE)) {
          const mat = materials.get(line.raw_material_id);
          if (!mat) continue;
          const supplierId = line.invoices?.supplier_id ?? null;
          const link = supplierId ? links.get(`${line.raw_material_id}|${supplierId}`) : undefined;
          const res = resolveLineCost({
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unit_price,
            totalAmount: line.total_amount,
            packageSize: line.package_size,
            packageUnit: line.package_unit,
            countPerPackage: line.count_per_package,
            description: line.description,
            baseUnit: mat.base_unit,
            supplierPackage: link
              ? {
                  baseUnitsPerPackage: link.base_units_per_package,
                  packageSize: link.package_size,
                  packageUnit: link.package_unit,
                  packageConfirmedAt: link.package_confirmed_at,
                }
              : null,
            rawMaterialPackage: {
              baseUnitsPerPackage: mat.base_units_per_package,
              packageSize: mat.package_size,
              packageUnit: mat.package_unit,
            },
          });

          let entry = acc.get(mat.id);
          if (!entry) {
            entry = { material: mat, best: null, updates: [], blocked: null, count: 0 };
            acc.set(mat.id, entry);
          }
          entry.count += 1;

          if (res.needsInput || !Number.isFinite(res.pricePerBaseUnit)) {
            if (!entry.blocked) entry.blocked = res;
            continue;
          }
          // Kreditnotaer gir negativ kostpris — de skal aldri bli en varekostpris.
          if (res.pricePerBaseUnit <= 0) continue;

          entry.updates.push({
            lineId: line.id,
            pricePerBaseUnit: res.pricePerBaseUnit,
            baseQuantity: res.baseQuantity,
          });
          const date = line.invoices?.invoice_date ?? "";
          const bestDate = entry.best?.line.invoices?.invoice_date ?? "";
          if (!entry.best || date > bestDate) entry.best = { line, res };
        }
        setProgress({
          phase: "beregner",
          done: Math.min(i + LINE_PAGE_SIZE, lines.length),
          total: lines.length,
          label: `Beregner kostpriser … ${Math.min(i + LINE_PAGE_SIZE, lines.length)} av ${lines.length}`,
        });
        await new Promise((r) => setTimeout(r, 0));
      }

      const out: RecalcRow[] = [];
      for (const entry of acc.values()) {
        const mat = entry.material;
        const current = mat.current_cost_price != null ? Number(mat.current_cost_price) : null;
        if (!entry.best) {
          const b = entry.blocked;
          out.push({
            rawMaterialId: mat.id,
            name: mat.name,
            sku: mat.sku,
            baseUnit: mat.base_unit,
            currentPrice: current,
            proposedPrice: null,
            changePct: null,
            packageFactor: null,
            invoiceId: null,
            invoiceNumber: null,
            invoiceDate: null,
            supplierId: null,
            explanation: b?.explanation ?? "Ingen brukbare fakturalinjer.",
            basis: null,
            confidence: 0,
            confidenceLevel: "low",
            needsInput: b?.needsInput ?? "amount",
            reason: b?.reason ?? b?.explanation ?? null,
            bucket: "umulig",
            lineUpdates: [],
            lineCount: entry.count,
          });
          continue;
        }

        const { line, res } = entry.best;
        const proposed = Math.round(res.pricePerBaseUnit * 1e6) / 1e6;
        const changePct =
          current != null && current > 0 ? ((proposed - current) / current) * 100 : null;
        const factor = current != null && current > 0 ? nearFactor(proposed / current) : null;
        const unchanged = changePct != null && Math.abs(changePct) < 0.5;
        const bucket: RecalcBucket = unchanged
          ? "uendret"
          : res.confidenceLevel === "high" && (changePct == null || Math.abs(changePct) < 500 || factor != null)
            ? "rettes"
            : "bekreft";

        out.push({
          rawMaterialId: mat.id,
          name: mat.name,
          sku: mat.sku,
          baseUnit: mat.base_unit,
          currentPrice: current,
          proposedPrice: proposed,
          changePct,
          packageFactor: factor,
          invoiceId: line.invoice_id,
          invoiceNumber: line.invoices?.invoice_number ?? null,
          invoiceDate: line.invoices?.invoice_date ?? null,
          supplierId: line.invoices?.supplier_id ?? null,
          explanation: res.explanation,
          basis: res.basis,
          confidence: res.confidence,
          confidenceLevel: res.confidenceLevel,
          needsInput: null,
          reason: res.reason,
          bucket,
          lineUpdates: entry.updates,
          lineCount: entry.count,
        });
      }

      out.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0) || a.name.localeCompare(b.name, "nb"));
      setRows(out);
      setProgress({ phase: "ferdig", done: lines.length, total: lines.length, label: `${lines.length} fakturalinjer gjennomgått` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(IDLE);
    }
  }, [legalEntityId]);

  const apply = useCallback(
    async (selected: RecalcRow[]) => {
      cancelRef.current = false;
      setError(null);
      setReceipt(null);
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id ?? null;

      let updatedMaterials = 0;
      let updatedLines = 0;
      const changes: number[] = [];

      try {
        for (let i = 0; i < selected.length; i += APPLY_CHUNK) {
          if (cancelRef.current) {
            setProgress({ phase: "avbrutt", done: updatedMaterials, total: selected.length, label: "Avbrutt" });
            break;
          }
          const chunk = selected.slice(i, i + APPLY_CHUNK);
          for (const row of chunk) {
            if (row.proposedPrice == null) continue;
            const now = new Date().toISOString();
            const { error: upErr } = await supabase
              .from("raw_materials")
              .update({
                current_cost_price: row.proposedPrice,
                price_source: "invoice",
                price_updated_at: now,
              })
              .eq("id", row.rawMaterialId);
            if (upErr) throw new Error(`${row.name}: ${upErr.message}`);

            const { error: histErr } = await supabase.from("raw_material_price_history").insert({
              raw_material_id: row.rawMaterialId,
              supplier_id: row.supplierId,
              price: row.proposedPrice,
              effective_date: row.invoiceDate ?? now.slice(0, 10),
              source: "invoice",
              source_reference: row.invoiceNumber,
              invoice_id: row.invoiceId,
              notes: `Reberegning av kostpris fra faktura ${row.invoiceNumber ?? "—"} (${row.invoiceDate ?? "ukjent dato"}). ${row.explanation}`,
              created_by: userId,
            });
            if (histErr) throw new Error(`${row.name}: ${histErr.message}`);

            for (const u of row.lineUpdates) {
              const { error: lineErr } = await supabase
                .from("invoice_lines")
                .update({
                  price_per_base_unit: u.pricePerBaseUnit,
                  base_quantity: u.baseQuantity,
                })
                .eq("id", u.lineId);
              if (lineErr) throw new Error(`${row.name} (fakturalinje): ${lineErr.message}`);
              updatedLines += 1;
            }

            updatedMaterials += 1;
            if (row.changePct != null) changes.push(row.changePct);
          }
          setProgress({
            phase: "skriver",
            done: updatedMaterials,
            total: selected.length,
            label: `Oppdaterer kostpriser … ${updatedMaterials} av ${selected.length}`,
          });
        }

        let statsRefreshed = false;
        if (updatedMaterials > 0) {
          const { error: rpcErr } = await supabase.rpc("refresh_purchase_stats");
          statsRefreshed = !rpcErr;
        }

        const applied = selected.slice(0, updatedMaterials);
        const withChange = applied.filter((r) => r.changePct != null);
        setReceipt({
          updatedMaterials,
          updatedLines,
          avgChangePct: changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : null,
          biggestUp: withChange.reduce<RecalcRow | null>((best, r) => (!best || (r.changePct ?? 0) > (best.changePct ?? 0) ? r : best), null),
          biggestDown: withChange.reduce<RecalcRow | null>((best, r) => (!best || (r.changePct ?? 0) < (best.changePct ?? 0) ? r : best), null),
          stillBlocked: (rows ?? []).filter((r) => r.bucket === "umulig").length,
          statsRefreshed,
        });
        setProgress({ phase: "ferdig", done: updatedMaterials, total: selected.length, label: "Ferdig" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setProgress({ phase: "ferdig", done: updatedMaterials, total: selected.length, label: "Stoppet med feil" });
      }
    },
    [rows],
  );

  const reset = useCallback(() => {
    setRows(null);
    setReceipt(null);
    setError(null);
    setProgress(IDLE);
  }, []);

  return { rows, progress, receipt, error, scan, apply, cancel, reset };
}
