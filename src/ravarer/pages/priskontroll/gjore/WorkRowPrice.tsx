import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInvoicePriceSafety } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { PRICE_REFERENCE_LABEL } from "@/ravarer/lib/labels";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { ppbu, signedPct } from "./logic";

/** Prislinje for en prisavvik-rad: forventet pris, pris på faktura og avvik i prosent. */
export function WorkRowPrice({ it }: { it: WorkItem }) {
  const lineId = it.type === "varekort" && it.kind === "prisavvik" ? it.last_open_line_id : null;
  const line = useQuery({
    queryKey: ["work-row-line", lineId],
    enabled: !!lineId,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await supabase.from("invoice_lines").select("id, invoice_id").eq("id", lineId as string).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const invoiceId = line.data?.invoice_id ?? null;
  const safety = useInvoicePriceSafety([invoiceId]);
  if (!lineId) return null;
  if (!invoiceId) return null;
  // Bare fersk, server-kontrollert sammenligning vises; ellers ingen tall.
  const g = safety.gateFor({ id: lineId, invoice_id: invoiceId });
  if (!g.ok) return null;
  const s = g.safety;
  if (!s.can_compare || s.price_per_base_unit == null || s.expected_price_per_base_unit == null || !(s.expected_price_per_base_unit > 0) || !s.base_unit) return null;
  const pct = ((s.price_per_base_unit - s.expected_price_per_base_unit) / s.expected_price_per_base_unit) * 100;
  const ref = s.reference_source ? PRICE_REFERENCE_LABEL[s.reference_source] : "Forventet";
  const many = it.open_lines > 1;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm tabular-nums text-ink-secondary" title={many ? "Siste åpne linje" : undefined}>
      <span>{ref}: {ppbu(s.expected_price_per_base_unit)} kr/{s.base_unit}</span>
      <span aria-hidden>→</span>
      <span className="text-foreground">Faktura{many ? " (siste)" : ""}: {ppbu(s.price_per_base_unit)} kr/{s.base_unit}</span>
      <span className={cn("font-medium", pct > 0 ? "text-destructive" : "text-success")}>{signedPct(pct)}</span>
    </p>
  );
}
