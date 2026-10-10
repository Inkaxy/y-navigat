import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";

/** Rolig lenke når leverandørvarer venter på kobling eller pakning. */
export function SupplierItemsBanner() {
  const c = useSupplierItems({ pageSize: 1 }).data?.counts;
  const n = c ? c.ukoblet + c.mangler_pakning : 0;
  if (n <= 0) return null;
  return (
    <Link to="/ravarer/fakturaer/varekoblinger" className="flex items-center gap-2 rounded-md border border-line-subtle bg-muted/40 px-3 py-2 text-sm hover:bg-muted">
      <span>{n} {n === 1 ? "leverandørvare venter" : "leverandørvarer venter"} på kobling eller pakning</span>
      <ArrowRight className="h-4 w-4" aria-hidden />
      <span className="font-medium">Varekoblinger</span>
    </Link>
  );
}
