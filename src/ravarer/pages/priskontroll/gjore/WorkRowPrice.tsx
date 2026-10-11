import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInvoicePriceSafety } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { PRICE_REFERENCE_LABEL } from "@/ravarer/lib/labels";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { ppbu, signedPct } from "./logic";

const Quiet = ({ text }: { text: string }) => <p className="text-caption text-ink-secondary">{text}</p>;

/** Prislinje for en prisavvik-rad: forventet pris, pris på faktura og avvik i prosent. */
export function WorkRowPrice({ it }: { it: WorkItem }) {
  const isPrice = it.type === "varekort" && it.kind === "prisavvik";
  const lineId = isPrice ? it.last_open_line_id : null;
  // Varekortets råvare (null = ukoblet). Kvittering for en annen råvare vises aldri under dette kortet.
  const expectedRm: string | null = it.type === "varekort" ? it.rm_id : null;
  const line = useQuery({
    queryKey: ["work-row-line", lineId],
    enabled: !!lineId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const r = await supabase.from("invoice_lines").select("id, invoice_id").eq("id", lineId as string).abortSignal(signal).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const invoiceId = line.data?.invoice_id ?? null;
  const safety = useInvoicePriceSafety([invoiceId], { rawMaterialId: expectedRm });
  if (!lineId) return null;
  if (line.isError) return <Quiet text="Prisgrunnlag ikke kontrollert" />;
  if (!invoiceId) return line.isLoading ? null : <Quiet text="Prisgrunnlag ikke kontrollert" />;
  // Bare fersk, server-kontrollert sammenligning for riktig råvare vises; ellers en stille status.
  const g = safety.gateFor({ id: lineId, invoice_id: invoiceId });
  if (!g.ok) return safety.loading ? null : <Quiet text="Prisgrunnlag ikke kontrollert" />;
  const s = g.safety;
  if (!s.can_compare || s.price_per_base_unit == null || s.expected_price_per_base_unit == null || !(s.expected_price_per_base_unit > 0) || !s.base_unit) return <Quiet text="Prisgrunnlag må kontrolleres" />;
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
