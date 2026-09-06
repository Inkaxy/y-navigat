import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, X } from "lucide-react";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { ITEM_TYPES, type ItemType } from "@/ravarer/lib/itemTypes";
import type { BulkPatch } from "@/ravarer/hooks/useBulkUpdateRawMaterials";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

interface Props {
  count: number;
  suppliers: SupplierRow[];
  existingCategories: string[];
  busy: boolean;
  onApply: (patch: BulkPatch) => void;
  onConfirmPackages: () => void;
  onExport: () => void;
  onClear: () => void;
}

/** Handlingslinje som vises nederst når rader er valgt. */
export function VarelisteBulkBar({
  count,
  suppliers,
  existingCategories,
  busy,
  onApply,
  onConfirmPackages,
  onExport,
  onClear,
}: Props) {
  const [category, setCategory] = useState("");
  const [itemType, setItemType] = useState("");
  const [supplierId, setSupplierId] = useState("");

  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-t-lg border border-border bg-card px-4 py-3 shadow-lg">
      <span className="text-sm font-medium">{count} valgt</span>

      <Select
        value={category}
        onValueChange={(v) => {
          setCategory(v);
          onApply({ kind: "category", category: v });
        }}
      >
        <SelectTrigger className="h-8 w-[170px]" disabled={busy}>
          <SelectValue placeholder="Sett kategori" />
        </SelectTrigger>
        <SelectContent>
          <CategorySelectItems existing={existingCategories} />
        </SelectContent>
      </Select>

      <Select
        value={itemType}
        onValueChange={(v) => {
          setItemType(v);
          onApply({ kind: "item_type", itemType: v as ItemType });
        }}
      >
        <SelectTrigger className="h-8 w-[160px]" disabled={busy}>
          <SelectValue placeholder="Sett varetype" />
        </SelectTrigger>
        <SelectContent>
          {ITEM_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={supplierId}
        onValueChange={(v) => {
          setSupplierId(v);
          onApply({ kind: "primary_supplier", supplierId: v });
        }}
      >
        <SelectTrigger className="h-8 w-[190px]" disabled={busy}>
          <SelectValue placeholder="Sett primærleverandør" />
        </SelectTrigger>
        <SelectContent>
          {suppliers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onApply({ kind: "active", isActive: true })}
      >
        Aktiver
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onApply({ kind: "active", isActive: false })}
      >
        Deaktiver
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onConfirmPackages}>
        Bekreft pakning
      </Button>
      <Button size="sm" variant="outline" onClick={onExport} className="gap-1.5">
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Eksporter CSV
      </Button>

      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto gap-1.5">
        <X className="h-3.5 w-3.5" aria-hidden="true" /> Tøm valg
      </Button>
    </div>
  );
}
