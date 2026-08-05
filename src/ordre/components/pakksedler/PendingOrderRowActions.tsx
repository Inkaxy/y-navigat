import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Eye, FileDown, ExternalLink, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNOK } from "@/ordre/lib/format";
import type { PendingOrderRow } from "@/ordre/hooks/usePendingOrdersList";

type Props = {
  row: PendingOrderRow;
};

type OrderLine = {
  id: string;
  line_number: number | null;
  quantity: number;
  sales_unit: string | null;
  product_snapshot: Record<string, any> | null;
};

function useOrderLines(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pending-order-lines", orderId],
    enabled,
    queryFn: async (): Promise<OrderLine[]> => {
      const { data, error } = await supabase
        .from("order_lines")
        .select("id, line_number, quantity, sales_unit, product_snapshot")
        .eq("order_id", orderId)
        .order("line_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OrderLine[];
    },
    staleTime: 30_000,
  });
}

export function PendingOrderRowActions({ row }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const isOrder = row.kind === "order";

  const linesQ = useOrderLines(row.id, open && isOrder);

  function goToSource() {
    if (isOrder) navigate(`/ordre/ordrer/${row.id}`);
    else navigate(`/ordre/faste-rutiner`);
  }

  async function downloadPdf() {
    if (!isOrder) {
      toast.info("PDF er tilgjengelig etter at fastordren er generert til en pakkseddel.");
      return;
    }
    setPdfBusy(true);
    try {
      // Hent ordre + linjer for å bygge en enkel ordrebekreftelse-PDF.
      const [{ data: order, error: orderErr }, { data: lines, error: linesErr }] =
        await Promise.all([
          supabase
            .from("orders")
            .select(
              "id, order_number, delivery_date, customer_snapshot, internal_notes, customer_notes, total_incl_vat",
            )
            .eq("id", row.id)
            .maybeSingle(),
          supabase
            .from("order_lines")
            .select("id, line_number, quantity, sales_unit, product_snapshot, unit_price, vat_rate, line_total_incl_vat")
            .eq("order_id", row.id)
            .order("line_number", { ascending: true }),
        ]);
      if (orderErr) throw orderErr;
      if (linesErr) throw linesErr;
      if (!order) throw new Error("Fant ikke ordren");

      const [{ pdf }, { OrderPreviewPDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./OrderPreviewPDFDocument"),
      ]);
      const blob = await pdf(
        <OrderPreviewPDFDocument
          order={order as any}
          lines={(lines ?? []) as any}
          tourLabel={row.tour_label}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const safe = (row.customer_display_name || "ordre")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ordre_${(order as any).order_number ?? row.id}_${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("PDF lastet ned");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Kunne ikke lage PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
            aria-label="Handlinger"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>{isOrder ? "Ordre" : "Fastordre-mal"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <Eye className="mr-2 h-4 w-4" />
            Forhåndsvis
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={downloadPdf} disabled={pdfBusy}>
            {pdfBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Last ned PDF
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={goToSource}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {isOrder ? "Gå til ordre" : "Gå til fastordre"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {row.customer_number && (
                <span className="tabular-nums text-muted-foreground">
                  {row.customer_number}
                </span>
              )}
              <span>{row.customer_display_name}</span>
              {!isOrder && (
                <Badge variant="outline" className="bg-amber-100 text-amber-900 border-amber-200">
                  Fastordre-mal
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {formatDate(row.delivery_date ?? "")} ·{" "}
              {row.tour_label ?? "uten tur"}
              {row.total_incl_vat > 0 && (
                <> · <span className="tabular-nums">{formatNOK(row.total_incl_vat)}</span></>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/30">
            {isOrder ? (
              linesQ.isLoading ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Laster ordrelinjer…
                </div>
              ) : linesQ.data && linesQ.data.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-background/60">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="w-10 px-2 py-1.5 text-right">#</th>
                      <th className="w-16 px-2 py-1.5">Nr.</th>
                      <th className="px-2 py-1.5">Vare</th>
                      <th className="w-16 px-2 py-1.5 text-right">Antall</th>
                      <th className="w-12 px-2 py-1.5">Enhet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linesQ.data.map((l, i) => {
                      const snap = (l.product_snapshot ?? {}) as Record<string, any>;
                      return (
                        <tr key={l.id} className="border-t border-border/40">
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {l.line_number ?? i + 1}
                          </td>
                          <td className="px-2 py-1 tabular-nums text-muted-foreground">
                            {snap.product_number ?? snap.number ?? ""}
                          </td>
                          <td className="px-2 py-1">
                            {snap.display_name ?? snap.name ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium">
                            {l.quantity}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {l.sales_unit ?? ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Ingen ordrelinjer.
                </div>
              )
            ) : (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Dette er en fastordre-mal. Linjer vises når malen er materialisert
                til en ordre eller pakkseddel.
              </div>
            )}
          </div>

          {row.notes && (
            <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs italic text-amber-900">
              {row.notes}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={downloadPdf} disabled={pdfBusy} className="gap-2">
              {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Last ned PDF
            </Button>
            <Button onClick={goToSource} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {isOrder ? "Gå til ordre" : "Gå til fastordre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
