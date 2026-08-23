import { Badge } from "@/components/ui/badge";
import { isNonRavare, itemTypeLabel } from "@/ravarer/lib/itemTypes";

/** Liten type-badge som kun vises for varer som ikke er råvarer. */
export function ItemTypeBadge({ itemType, className }: { itemType?: string | null; className?: string }) {
  if (!isNonRavare(itemType)) return null;
  return (
    <Badge variant="outline" className={className}>
      {itemTypeLabel(itemType)}
    </Badge>
  );
}
