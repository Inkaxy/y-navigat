import { categorizePriceSource } from "@/ordre/hooks/useNBProducts";

const STYLES: Record<string, string> = {
  standard: "bg-muted text-muted-foreground",
  special_general: "bg-warning/15 text-warning",
  special_customer: "bg-primary/15 text-primary",
  manual: "bg-destructive/15 text-destructive",
  none: "bg-muted text-muted-foreground",
};

/** Viser hvor prisen på en ordrelinje kommer fra (standard, spesial, manuell …). */
export function PriceSourceBadge({ source }: { source: string | null }) {
  const cat = categorizePriceSource(source);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STYLES[cat.category]}`}
    >
      {cat.label}
    </span>
  );
}
