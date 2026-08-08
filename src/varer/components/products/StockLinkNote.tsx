import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";
import { useProductStockLinks } from "@/ravarer/hooks/useStock";

/** Liten opplysning på varekortet: hvilke handelsvarer salget trekker fra. */
export function StockLinkNote({ productId }: { productId?: string }) {
  const { data: links = [] } = useProductStockLinks(productId);
  if (!productId || links.length === 0) return null;

  return (
    <div className="rounded-md border border-line-subtle bg-muted/30 p-3 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <Boxes className="h-4 w-4" /> Trekker fra lager
      </div>
      <ul className="space-y-1">
        {links.map(l => (
          <li key={l.id} className="text-muted-foreground">
            {l.raw_material ? (
              <Link to={`/ravarer/vareliste/${l.raw_material.id}`} className="hover:underline">
                {l.raw_material.name}
              </Link>
            ) : (
              "Ukjent handelsvare"
            )}
            {" — "}
            {l.base_units_per_sold_unit} {l.raw_material?.base_unit ?? ""} per solgt vare
            {l.raw_material && !l.raw_material.stock_tracking && " (lagerføring av)"}
          </li>
        ))}
      </ul>
    </div>
  );
}
