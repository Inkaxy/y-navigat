import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";

/**
 * Aliaslæring som ren funksjon.
 *
 * Når et menneske bekrefter en match lærer systemet to ting: aliasene som
 * peker på ANDRE varer hos samme leverandør skal pensjoneres, og varene
 * brukeren aktivt valgte bort skal få et avvist alias. Regnestykket er rent —
 * det tar rader inn og gir en plan ut — slik at det kan testes uten database.
 */

export type AliasType = "supplier_sku" | "product_name";

export interface AliasRecord {
  id: string;
  raw_material_supplier_id: string;
  alias_type: string;
  alias_value: string;
  alias_value_normalized: string | null;
  status: string;
}

export interface SupplierLinkRecord {
  id: string;
  raw_material_id: string;
}

export interface AliasValue {
  alias_type: AliasType;
  alias_value: string;
}

export interface AliasLearningInput {
  /** Varen linjen ble matchet mot. */
  rawMaterialId: string;
  /** Alle koblinger leverandøren har, uansett vare. */
  supplierLinks: SupplierLinkRecord[];
  /** Alle alias på leverandørens koblinger. */
  existingAliases: AliasRecord[];
  /** Aliasene som bekreftes i denne matchen. */
  confirmedAliases: AliasValue[];
  /** Varene brukeren aktivt valgte bort. */
  rejectedRawMaterialIds: string[];
  /** Verdiene fra fakturalinjen som skal avvises mot de bortvalgte varene. */
  lineValues: AliasValue[];
}

export interface AliasLearningPlan {
  /** Alias som skal settes til «superseded». */
  supersedeIds: string[];
  /** Eksisterende alias som skal settes til «rejected». */
  rejectExistingIds: string[];
  /** Avviste alias som må settes inn fordi de ikke finnes fra før. */
  rejectNewRows: Array<{
    raw_material_supplier_id: string;
    alias_type: AliasType;
    alias_value: string;
  }>;
}

const keyOf = (a: Pick<AliasRecord, "alias_value" | "alias_value_normalized">) =>
  normalizeMatchKey(a.alias_value_normalized ?? a.alias_value);

export function planAliasLearning(input: AliasLearningInput): AliasLearningPlan {
  const {
    rawMaterialId,
    supplierLinks,
    existingAliases,
    confirmedAliases,
    rejectedRawMaterialIds,
    lineValues,
  } = input;

  const plan: AliasLearningPlan = {
    supersedeIds: [],
    rejectExistingIds: [],
    rejectNewRows: [],
  };

  // 1) Pensjonér motstridende alias hos samme leverandør som peker på ANDRE varer.
  if (confirmedAliases.length > 0) {
    const otherLinkIds = new Set(
      supplierLinks.filter((l) => l.raw_material_id !== rawMaterialId).map((l) => l.id),
    );
    plan.supersedeIds = existingAliases
      .filter(
        (a) =>
          a.status === "confirmed" &&
          otherLinkIds.has(a.raw_material_supplier_id) &&
          confirmedAliases.some(
            (ins) => ins.alias_type === a.alias_type && normalizeMatchKey(ins.alias_value) === keyOf(a),
          ),
      )
      .map((a) => a.id);
  }

  // 2) Lær av det brukeren valgte BORT.
  if (rejectedRawMaterialIds.length > 0 && lineValues.length > 0) {
    const rejected = new Set(rejectedRawMaterialIds);
    const rejectedLinkIds = supplierLinks.filter((l) => rejected.has(l.raw_material_id)).map((l) => l.id);
    for (const linkId of rejectedLinkIds) {
      for (const v of lineValues) {
        if (!v.alias_value) continue;
        const hit = existingAliases.find(
          (a) =>
            a.raw_material_supplier_id === linkId &&
            a.alias_type === v.alias_type &&
            keyOf(a) === normalizeMatchKey(v.alias_value),
        );
        if (hit) {
          if (hit.status !== "rejected") plan.rejectExistingIds.push(hit.id);
        } else {
          plan.rejectNewRows.push({
            raw_material_supplier_id: linkId,
            alias_type: v.alias_type,
            alias_value: v.alias_value,
          });
        }
      }
    }
  }

  return plan;
}
