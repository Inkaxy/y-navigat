import { useState } from "react";
import { Tags } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";
import { SupplierItemSheet } from "./SupplierItemSheet";

interface Props {
  supplierId: string | null | undefined;
  line: { supplier_sku?: string | null; description?: string | null };
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Bare ikon (med aria-label) — for tette tabeller. */
  iconOnly?: boolean;
  onDone?: () => void;
  /** Kalles når panelet lukkes etter en vellykket kobling. */
  onClosedAfterDone?: () => void;
}

/** «Åpne varekort» for en fakturalinje. Skjules når linjen mangler leverandør eller identitet. */
export function OpenSupplierItemButton({ supplierId, line, variant = "outline", size = "sm", className, iconOnly, onDone, onClosedAfterDone }: Props) {
  const [open, setOpen] = useState(false);
  const [didLink, setDidLink] = useState(false);
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v && didLink) { setDidLink(false); onClosedAfterDone?.(); }
  };
  const key = supplierItemKey(line);
  if (!supplierId || !key) return null;
  return (
    <>
      <Button type="button" variant={variant} size={iconOnly ? "icon" : size} className={className} aria-label={iconOnly ? "Åpne varekort" : undefined} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Tags className={iconOnly ? "h-4 w-4" : "mr-1 h-4 w-4"} aria-hidden />
        {!iconOnly && "Åpne varekort"}
      </Button>
      <SupplierItemSheet supplierId={supplierId} itemKey={key} open={open} onOpenChange={onOpenChange} onDone={() => { setDidLink(true); onDone?.(); }} />
    </>
  );
}
