import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Package, Search, X } from "lucide-react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { toast } from "sonner";

export interface PickupOrderRow {
  id: string;
  order_number: string;
  delivery_date: string;
  final_customer_name: string | null;
  final_customer_phone: string | null;
  is_paid: boolean;
  payment_mode: string | null;
  status: string;
  total_incl_vat: number;
}

export interface PickupOrderLine {
  order_line_id: string;
  product_id: string | null;
  product_snapshot: { display_name?: string; unit?: string; mva_rate?: number } | null;
  quantity: number;
  unit_price_excl_mva: number;
  mva_rate: number;
  original_unit_price: number;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  legalEntityId: string | null;
  pickupLocationId: string | null;
  onLoadOrder: (order: PickupOrderRow, lines: PickupOrderLine[]) => void;
}

export function HenteordreModal({
  open,
  onOpenChange,
  legalEntityId,
  pickupLocationId,
  onLoadOrder,
}: Props) {
  const [rows, setRows] = useState<PickupOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || !legalEntityId) return;
    let cancel = false;
    setLoading(true);
    setSearch("");

    const fetchRows = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await kioskSupabase.rpc(
        "pos_list_pickup_orders" as never,
        {
          p_legal_entity_id: legalEntityId,
          p_pickup_location_id: pickupLocationId,
          p_date: today,
        } as never,
      );
      if (cancel) return;
      if (error) {
        if (showSpinner) {
          toast.error("Kunne ikke laste henteordrer", { description: error.message });
        }
      } else {
        setRows((data ?? []) as unknown as PickupOrderRow[]);
      }
      if (showSpinner) setLoading(false);
    };

    void fetchRows(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchRows(false);
    }, 10_000);

    return () => {
      cancel = true;
      window.clearInterval(interval);
    };
  }, [open, legalEntityId, pickupLocationId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.order_number,
        r.final_customer_name ?? "",
        r.final_customer_phone ?? "",
        r.delivery_date,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const handleSelect = async (row: PickupOrderRow) => {
    setLoadingId(row.id);
    try {
      const { data, error } = await kioskSupabase.rpc(
        "pos_load_pickup_order" as never,
        { p_order_id: row.id } as never,
      );
      if (error) throw error;
      const payload = data as unknown as { lines: PickupOrderLine[] };
      onLoadOrder(row, payload?.lines ?? []);
      onOpenChange(false);
    } catch (e) {
      toast.error("Kunne ikke laste ordrelinjer", { description: (e as Error).message });
    } finally {
      setLoadingId(null);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] h-[min(80svh,640px)] overflow-hidden flex flex-col top-4 translate-y-0 sm:top-6 data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-top-4 p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Henteordre
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({filtered.length} av {rows.length})
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative px-6 py-3 shrink-0 border-b bg-background">
          <Search className="absolute left-9 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk på ordrenummer, navn eller telefon…"
            className="pl-9 pr-9 h-11 text-base"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Tøm søk"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-3">

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {rows.length === 0 ? "Ingen åpne henteordrer." : "Ingen treff på søket."}
            </div>
          ) : (
            <div className="divide-y border rounded-md">
              {filtered.map((r) => {
                const isToday = r.delivery_date === todayStr;
                const isOverdue = r.delivery_date < todayStr;
                return (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r)}
                    disabled={loadingId !== null}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        #{r.order_number} — {r.final_customer_name ?? "Uten navn"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.final_customer_phone ?? "—"} · Henting:{" "}
                        <span
                          className={
                            isOverdue
                              ? "text-destructive font-medium"
                              : isToday
                                ? "text-foreground font-medium"
                                : ""
                          }
                        >
                          {r.delivery_date}
                          {isOverdue ? " (forsinket)" : isToday ? " (i dag)" : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.is_paid ? (
                        <Badge variant="secondary">Betalt på nett</Badge>
                      ) : (
                        <Badge>Ubetalt</Badge>
                      )}
                      <div className="text-sm tabular-nums w-24 text-right">
                        {r.is_paid ? "0,00" : r.total_incl_vat.toFixed(2)} kr
                      </div>
                      {loadingId === r.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
