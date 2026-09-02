import { useEffect, useMemo, useState } from "react";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { usePreviewDeliveryRules } from "@/ordre/hooks/usePreviewDeliveryRules";
import { DeliveryRulesFeedback } from "@/ordre/components/rules/DeliveryRulesFeedback";
import { OverrideRuleDialog } from "@/ordre/components/rules/OverrideRuleDialog";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Loader2, Trash2, Save, Lock, Plus, ShoppingCart, Copy, ClipboardList, Info, Repeat } from "lucide-react";
import { OrderInfoDialog } from "./OrderInfoDialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTourOrder,
  claimOrderRevision,
  OrderConflictError,
  useUpdateOrderLine,
  useDeleteOrderLine,
  type TourOrderLine,
} from "@/ordre/hooks/useTourOrder";
import { useRecurringGhost } from "@/ordre/hooks/useRecurringGhost";
import { useProductsByIds } from "@/ordre/hooks/useProductsByIds";
import type { MatrixProduct, MatrixTour } from "@/ordre/hooks/useMatrix";
import { formatNOK } from "@/ordre/lib/format";
import { OrderKindBadge } from "@/ordre/components/orders/OrderKindBadge";
import { LifecycleBadge } from "@/ordre/components/orders/LifecycleBadge";
import { useOrdersLifecycle } from "@/ordre/hooks/useOrdersLifecycle";
import { cn } from "@/lib/utils";

const LOCKED_STATUSES = new Set(["invoiced", "cancelled"]);

const DAY_NAMES = [
  "Søndag",
  "Mandag",
  "Tirsdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lørdag",
];

function formatHeader(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]} ${new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d)}`;
}

type LineEdit = {
  quantity?: string;
  unit_price?: string;
  discount_percent?: string;
  notes?: string;
};

export function TourOrderDialog({
  open,
  onOpenChange,
  customer,
  date,
  tour,
  products,
  canEdit,
  onCreatePackingNote,
  onCopyOrder,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: { id: string; customer_number: string; display_name: string } | null;
  date: string | null;
  tour: MatrixTour | null;
  products: MatrixProduct[];
  canEdit: boolean;
  onCreatePackingNote?: () => void;
  onCopyOrder?: () => void;
}) {
  const { data: order, isLoading } = useTourOrder({
    customerId: customer?.id ?? null,
    date,
    tourId: tour?.id ?? null,
  });
  const updateLine = useUpdateOrderLine();
  const deleteLine = useDeleteOrderLine();
  const qc = useQueryClient();

  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [showPrices, setShowPrices] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setEdits({});
      setAddSearch("");
    }
  }, [open]);

  const locked = !!order && LOCKED_STATUSES.has(order.status);
  const { map: lifecycleMap } = useOrdersLifecycle(order ? [order.id] : []);
  const orderLc = order ? lifecycleMap.get(order.id) : undefined;
  const readOnly = locked || !canEdit;

  const productMap = useMemo(() => {
    const m = new Map<string, MatrixProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const dirtyCount = Object.keys(edits).length;

  function patch(lineId: string, p: LineEdit) {
    setEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...p } }));
  }

  // Leveringsregel-preview for hele ordren
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const hasOrdreWrite = access?.hasOrdreWrite ?? false;
  const productIdsForRules = useMemo(() => {
    if (!order) return [];
    const out: string[] = [];
    for (const l of order.lines) {
      const qty = edits[l.id]?.quantity != null ? Number(edits[l.id]!.quantity!.replace(",", ".") || 0) : Number(l.quantity);
      if (qty > 0 && l.product_id) out.push(l.product_id);
    }
    return out;
  }, [order, edits]);
  const rulesPreview = usePreviewDeliveryRules({
    legalEntityId: (order as any)?.legal_entity_id ?? NB_LEGAL_ENTITY_ID,
    customerId: customer?.id ?? null,
    deliveryDate: date,
    deliveryTourId: tour?.id ?? null,
    productIds: productIdsForRules,
    existingOrderId: order?.id ?? null,
  });
  const [overrideOpen, setOverrideOpen] = useState(false);

  function getQty(l: TourOrderLine): number {
    const raw = edits[l.id]?.quantity;
    if (raw != null) return Number(raw.replace(",", ".") || 0);
    return Number(l.quantity);
  }
  function getPrice(l: TourOrderLine): number {
    const raw = edits[l.id]?.unit_price;
    if (raw != null) return Number(raw.replace(",", ".") || 0);
    return Number(l.unit_price);
  }
  function lineSum(l: TourOrderLine): number {
    const q = getQty(l);
    const p = getPrice(l);
    const d = Number(edits[l.id]?.discount_percent ?? l.discount_percent ?? 0);
    return q * p * (1 - d / 100);
  }

  const totals = useMemo(() => {
    if (!order) return { sub: 0, incl: 0 };
    let sub = 0;
    let incl = 0;
    for (const l of order.lines) {
      const s = lineSum(l);
      const vat = Number(l.vat_rate ?? 15);
      sub += s;
      incl += s * (1 + vat / 100);
    }
    return { sub, incl };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, edits]);

  async function saveAll(overrideReason: string | null = null) {
    if (!order || readOnly) return;
    if (rulesPreview.blocks.length > 0 && !overrideReason) {
      toast.error(`Kan ikke lagre — bryter leveringsregel: ${rulesPreview.blocks[0].message}`);
      return;
    }
    setSavingAll(true);
    try {
      // Optimistisk lås: sikrer at ingen andre har endret ordren siden den ble lastet.
      const claimedAt = await claimOrderRevision(order.id, order.updated_at);

      if (overrideReason) {
        const { data: ovRows, error: ovErr } = await supabase
          .from("orders")
          .update({ rule_override_reason: overrideReason } as never)
          .eq("id", order.id)
          .eq("updated_at", claimedAt)
          .select("id");
        if (ovErr) throw ovErr;
        if ((ovRows ?? []).length === 0) throw new OrderConflictError();
      }

      const ops: PromiseLike<unknown>[] = [];
      for (const [lineId, e] of Object.entries(edits)) {
        const patch: Record<string, unknown> = {};
        if (e.quantity !== undefined) patch.quantity = Number(e.quantity.replace(",", ".") || 0);
        if (e.unit_price !== undefined) {
          patch.unit_price = Number(e.unit_price.replace(",", ".") || 0);
          patch.unit_price_source = "manual";
        }
        if (e.discount_percent !== undefined)
          patch.discount_percent = Number(e.discount_percent.replace(",", ".") || 0);
        if (e.notes !== undefined) patch.notes = e.notes;
        if (Object.keys(patch).length === 0) continue;

        // qty=0 → delete line
        if (patch.quantity === 0) {
          ops.push(supabase.from("order_lines").delete().eq("id", lineId));
        } else {
          ops.push(
            supabase.from("order_lines").update(patch as never).eq("id", lineId),
          );
        }
      }
      const results = await Promise.all(ops);
      const firstErr = results.find((r: any) => r?.error);
      if (firstErr) throw (firstErr as any).error;
      toast.success("Endringer lagret");
      setEdits({});
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
    } catch (e: unknown) {
      if (e instanceof OrderConflictError) {
        toast.error("Ordren er endret av noen andre — laster på nytt");
        setEdits({});
        qc.invalidateQueries({ queryKey: ["tour-order"] });
        qc.invalidateQueries({ queryKey: ["matrix"] });
      } else {
        console.error("[TourOrderDialog] saveAll", e);
        toast.error("Kunne ikke lagre. Prøv igjen — kontakt support hvis det gjentar seg.");
      }
    } finally {
      setSavingAll(false);
    }
  }

  async function addProduct(p: MatrixProduct) {
    if (!order || readOnly || !customer || !date || !tour) return;
    // Bruk samme transaksjonelle RPC som ordrematrisen — den henter sentral pris
    // (get_customer_unit_price) for kunde/produkt/dato og setter unit_price_source.
    const { error } = await supabase.rpc("save_matrix_changes", {
      p_customer_id: customer.id,
      p_changes: [{ date, tour_id: tour.id, product_id: p.id, quantity: 1 }] as unknown as never,
    });
    if (error) {
      toast.error("Kunne ikke legge til linje", { description: error.message });
      return;
    }
    toast.success(`La til ${p.display_name}`);
    setAddOpen(false);
    setAddSearch("");
    qc.invalidateQueries({ queryKey: ["tour-order"] });
    qc.invalidateQueries({ queryKey: ["matrix"] });
  }

  const [deleting, setDeleting] = useState(false);
  async function deleteWholeOrder() {
    if (!order || readOnly) return;
    if (!confirm(`Slett hele ordren #${order.order_number}?\n\nAlle ${order.lines.length} linjer fjernes.`)) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("orders").delete().eq("id", order.id);
      if (error) throw error;
      toast.success(`Ordre #${order.order_number} slettet`);
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Kunne ikke slette ordren", { description: e?.message });
    } finally {
      setDeleting(false);
    }
  }

  const addableProducts = useMemo(() => {
    if (!order) return [] as MatrixProduct[];
    const already = new Set(order.lines.map((l) => l.product_id));
    return products.filter((p) => !already.has(p.id));
  }, [products, order]);

  // ── Fastordre-ghost for denne datoen + turen ──
  const { data: ghostMap } = useRecurringGhost(customer?.id ?? null, date ?? "", date ?? "");
  const ghostRows = useMemo(() => {
    if (!ghostMap || !date || !tour) return [] as { productId: string; quantity: number }[];
    const usedProductIds = new Set((order?.lines ?? []).map((l) => l.product_id));
    const rows: { productId: string; quantity: number }[] = [];
    for (const [key, qty] of ghostMap.entries()) {
      const [d, tid, pid] = key.split("|");
      if (d !== date || tid !== tour.id) continue;
      if (usedProductIds.has(pid)) continue;
      rows.push({ productId: pid, quantity: qty });
    }
    return rows;
  }, [ghostMap, date, tour, order]);

  const ghostMissingIds = useMemo(
    () => ghostRows.map((g) => g.productId).filter((id) => !productMap.has(id)),
    [ghostRows, productMap],
  );
  const { data: ghostExtraProducts } = useProductsByIds(ghostMissingIds);
  const ghostProductMap = useMemo(() => {
    const m = new Map<string, MatrixProduct>(productMap);
    for (const p of ghostExtraProducts ?? []) m.set(p.id, p);
    return m;
  }, [productMap, ghostExtraProducts]);

  async function addGhostAsLine(productId: string, quantity: number) {
    const p = ghostProductMap.get(productId);
    if (!p || !customer || !date || !tour) return;
    if (readOnly) return;
    try {
      // Bruk samme transaksjonelle RPC som ordrematrisen: den oppretter ordrehodet
      // med alle påkrevde felter (legal_entity_id, ordrenummer, source) og setter pris.
      const { error } = await supabase.rpc("save_matrix_changes", {
        p_customer_id: customer.id,
        p_changes: [
          { date, tour_id: tour.id, product_id: p.id, quantity },
        ] as unknown as never,
      });
      if (error) throw error;

      toast.success(`La til ${p.display_name} fra fastordre`);
      qc.invalidateQueries({ queryKey: ["tour-order"] });
      qc.invalidateQueries({ queryKey: ["matrix"] });
    } catch (e: any) {
      toast.error("Kunne ikke legge til", { description: e?.message });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle asChild>
            <div className="flex items-start gap-3">
              <ShoppingCart className="mt-1 h-6 w-6 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-2xl font-semibold tracking-tight">
                  {customer
                    ? `Ordre for ${customer.display_name} (${customer.customer_number})`
                    : "Ordre"}
                </div>
                {date && tour ? (
                  <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">
                      {formatHeader(date)} — tur {tour.tour_number}
                    </span>
                    <button
                      type="button"
                      onClick={() => setInfoOpen(true)}
                      disabled={!order}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-40"
                      title="Ordreinfo"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                    <span>
                      · {tour.display_name} ({tour.time_from.slice(0, 5)}–{tour.time_to.slice(0, 5)})
                    </span>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {order ? (
                    <>
                      <Badge variant="outline" className="font-mono">
                        #{order.order_number}
                      </Badge>
                      <OrderKindBadge kind={orderLc?.order_kind ?? "dated"} />
                      <LifecycleBadge
                        lifecycle={orderLc?.lifecycle ?? "open"}
                        deliveryNoteNumber={orderLc?.delivery_note_number}
                      />
                      {order.is_paid ? <Badge variant="secondary">Betalt</Badge> : null}
                    </>
                  ) : null}
                  {locked ? (
                    <Badge className="bg-amber-100 text-amber-900 border-amber-200 gap-1">
                      <Lock className="h-3 w-3" /> Fakturert — kan ikke endres
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Ferdig
                </Button>
                {!readOnly && order ? (
                  rulesPreview.blocks.length > 0 && hasOrdreWrite ? (
                    <Button
                      size="sm"
                      variant="brand"
                      onClick={() => setOverrideOpen(true)}
                      disabled={savingAll}
                    >
                      Overstyr …
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => saveAll()}
                      disabled={dirtyCount === 0 || savingAll || rulesPreview.blocks.length > 0}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {savingAll ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Lagre{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-4">
          {order && (
            <DeliveryRulesFeedback
              className="mb-4"
              blocks={rulesPreview.blocks}
              warns={rulesPreview.warns}
              infos={rulesPreview.infos}
              blockedHint={
                rulesPreview.blocks.length > 0 && !hasOrdreWrite
                  ? "Endringene kan ikke lagres. Kontakt ordrekontoret."
                  : undefined
              }
            />
          )}
          {isLoading ? (
            <div className="grid place-items-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !order ? (
            <div className="space-y-4">
              <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                Ingen ordre for denne kunden, datoen og turen ennå.
                {ghostRows.length > 0
                  ? " Fastordre-forslagene under kan legges til for å opprette en ordre."
                  : " Legg til antall i matrisen for å opprette ordren."}
              </div>
              {ghostRows.length > 0 ? (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border">
                      <tr className="bg-muted/40">
                        <td colSpan={5} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Repeat className="h-3 w-3" />
                            Fra fastordre
                          </span>
                        </td>
                      </tr>
                      {ghostRows.map((g) => {
                        const p = ghostProductMap.get(g.productId);
                        return (
                          <tr key={`ghost-${g.productId}`} className="bg-blue-50/40 dark:bg-blue-950/20 text-muted-foreground">
                            <td className="w-14 px-2 py-2 tabular-nums text-right">{p?.display_number ?? ""}</td>
                            <td className="px-2 py-2 font-medium">
                              <span className="flex items-center gap-2">
                                <Repeat className="h-3.5 w-3.5 text-blue-600" />
                                {p?.display_name ?? "—"}
                              </span>
                            </td>
                            <td className="w-24 px-2 py-2 text-center text-base font-semibold tabular-nums">
                              {g.quantity}
                            </td>
                            <td className="w-16 px-2 py-2 text-sm">{p?.sales_unit ?? ""}</td>
                            <td className="w-28 px-2 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={readOnly}
                                onClick={() => addGhostAsLine(g.productId, g.quantity)}
                                className="h-7 text-xs"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Legg til
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

          ) : (
            <>
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowPrices((v) => !v)}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {showPrices ? "skjul priser" : "vis priser"}
                </button>
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {order.lines.map((l) => {
                      const p = productMap.get(l.product_id);
                      const snap = (l.product_snapshot ?? {}) as {
                        display_number?: number;
                        display_name?: string;
                      };
                      const displayNumber = p?.display_number ?? snap.display_number ?? "";
                      const displayName = p?.display_name ?? snap.display_name ?? "—";
                      const rawQty = edits[l.id]?.quantity ?? String(Number(l.quantity));
                      const rawPrice = edits[l.id]?.unit_price ?? String(Number(l.unit_price));
                      const sum = lineSum(l);
                      return (
                        <tr key={l.id} className="hover:bg-muted/30">
                          <td className="w-14 px-2 py-2 tabular-nums text-muted-foreground text-right">
                            {displayNumber}
                          </td>
                          <td className="px-2 py-2 font-medium">{displayName}</td>
                          <td className="w-24 px-2 py-2">
                            <Input
                              value={rawQty}
                              readOnly={readOnly}
                              onChange={(e) => patch(l.id, { quantity: e.target.value })}
                              className={cn(
                                "h-9 text-center text-base font-semibold tabular-nums",
                                edits[l.id]?.quantity !== undefined && "bg-warning/10",
                              )}
                            />
                          </td>
                          <td className="w-16 px-2 py-2 text-muted-foreground text-sm">
                            {l.sales_unit ?? ""}
                          </td>
                          {showPrices ? (
                            <>
                              <td className="w-32 px-2 py-2 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-muted-foreground text-xs">à</span>
                                  <Input
                                    value={rawPrice}
                                    readOnly={readOnly}
                                    onChange={(e) => patch(l.id, { unit_price: e.target.value })}
                                    title={
                                      p?.unit_price != null
                                        ? `varepris er ${formatNOK(p.unit_price)}`
                                        : undefined
                                    }
                                    className={cn(
                                      "h-8 w-20 text-right tabular-nums",
                                      edits[l.id]?.unit_price !== undefined && "bg-warning/10",
                                    )}
                                  />
                                  <span className="text-muted-foreground text-xs">=</span>
                                </div>
                              </td>
                              <td className="w-28 px-2 py-2 text-right tabular-nums">
                                {formatNOK(sum)}
                              </td>
                            </>
                          ) : null}
                          <td className="w-28 px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className={cn(
                                      "rounded p-1 hover:bg-accent",
                                      l.notes ? "text-primary" : "text-muted-foreground/70",
                                    )}
                                    title="Kommentar"
                                  >
                                    💬
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72">
                                  <label className="text-xs font-medium">Kommentar</label>
                                  <Input
                                    value={edits[l.id]?.notes ?? l.notes ?? ""}
                                    readOnly={readOnly}
                                    onChange={(e) => patch(l.id, { notes: e.target.value })}
                                    placeholder="Legg til kommentar"
                                    className="mt-1"
                                  />
                                </PopoverContent>
                              </Popover>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className={cn(
                                      "rounded p-1 hover:bg-accent",
                                      Number(l.discount_percent ?? 0) > 0
                                        ? "text-primary"
                                        : "text-muted-foreground/70",
                                    )}
                                    title="Rabatt"
                                  >
                                    %
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48">
                                  <label className="text-xs font-medium">Rabatt (%)</label>
                                  <Input
                                    value={
                                      edits[l.id]?.discount_percent ??
                                      String(Number(l.discount_percent ?? 0))
                                    }
                                    readOnly={readOnly}
                                    onChange={(e) =>
                                      patch(l.id, { discount_percent: e.target.value })
                                    }
                                    className="mt-1 text-right tabular-nums"
                                  />
                                </PopoverContent>
                              </Popover>
                              <button
                                type="button"
                                disabled={readOnly || deleteLine.isPending}
                                onClick={() => {
                                  if (!confirm(`Slett linje: ${displayName}?`)) return;
                                  deleteLine.mutate(l.id, {
                                    onSuccess: () => toast.success("Linje slettet"),
                                    onError: (e: any) =>
                                      toast.error("Kunne ikke slette", { description: e?.message }),
                                  });
                                }}
                                className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                                title="Slett"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {order.lines.length === 0 && ghostRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                          Ingen linjer på ordren.
                        </td>
                      </tr>
                    ) : null}
                    {ghostRows.length > 0 ? (
                      <>
                        <tr className="bg-muted/40">
                          <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Repeat className="h-3 w-3" />
                              Fra fastordre
                            </span>
                          </td>
                        </tr>
                        {ghostRows.map((g) => {
                          const p = ghostProductMap.get(g.productId);
                          const displayNumber = p?.display_number ?? "";
                          const displayName = p?.display_name ?? "—";
                          const unitPrice = p?.unit_price ?? null;
                          const sum = unitPrice != null ? unitPrice * g.quantity : null;
                          return (
                            <tr key={`ghost-${g.productId}`} className="bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/60 text-muted-foreground">
                              <td className="w-14 px-2 py-2 tabular-nums text-right">{displayNumber}</td>
                              <td className="px-2 py-2 font-medium">
                                <span className="flex items-center gap-2">
                                  <Repeat className="h-3.5 w-3.5 text-blue-600" />
                                  {displayName}
                                </span>
                              </td>
                              <td className="w-24 px-2 py-2 text-center text-base font-semibold tabular-nums">
                                {g.quantity}
                              </td>
                              <td className="w-16 px-2 py-2 text-sm">{p?.sales_unit ?? ""}</td>
                              {showPrices ? (
                                <>
                                  <td className="w-32 px-2 py-2 text-right text-xs">
                                    {unitPrice != null ? `à ${formatNOK(unitPrice)}` : "—"}
                                  </td>
                                  <td className="w-28 px-2 py-2 text-right tabular-nums">
                                    {sum != null ? formatNOK(sum) : "—"}
                                  </td>
                                </>
                              ) : null}
                              <td className="w-28 px-2 py-2">
                                <div className="flex items-center justify-end">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={readOnly}
                                    onClick={() => addGhostAsLine(g.productId, g.quantity)}
                                    className="h-7 text-xs"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Legg til
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    ) : null}

                  </tbody>
                </table>
              </div>

              {!readOnly ? (
                <div className="mt-3 flex items-center gap-2">
                  <Popover open={addOpen} onOpenChange={setAddOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Plus className="h-4 w-4" /> Ny ordrelinje
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-0">
                      <Command>
                        <CommandInput
                          placeholder="Søk varenr eller navn…"
                          value={addSearch}
                          onValueChange={setAddSearch}
                        />
                        <CommandList>
                          <CommandEmpty>Ingen produkter funnet.</CommandEmpty>
                          <CommandGroup>
                            {addableProducts.slice(0, 50).map((p) => (
                              <CommandItem
                                key={p.id}
                                value={`${p.display_number} ${p.display_name}`}
                                onSelect={() => addProduct(p)}
                              >
                                <span className="w-12 tabular-nums text-muted-foreground">
                                  {p.display_number}
                                </span>
                                <span className="flex-1 truncate">{p.display_name}</span>
                                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                                  {p.unit_price != null ? formatNOK(p.unit_price) : "—"}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : null}

              <div className="mt-6 flex items-center justify-end gap-6 text-sm">
                <div className="flex items-center gap-6 rounded-md bg-muted/40 px-4 py-2">
                  <span className="text-muted-foreground">Σ Pris ordre:</span>
                  <span className="font-semibold tabular-nums">{formatNOK(totals.sub)}</span>
                  <span className="text-muted-foreground">(inkl. MVA:</span>
                  <span className="font-semibold tabular-nums">{formatNOK(totals.incl)})</span>
                </div>
              </div>
            </>
          )}
        </div>

        {order ? (
          <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-6 py-3">
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteWholeOrder}
                disabled={readOnly || deleting}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Slett
              </Button>
              {onCreatePackingNote ? (
                <Button
                  size="sm"
                  onClick={onCreatePackingNote}
                  disabled={order.lines.length === 0}
                  className="bg-amber-400 hover:bg-amber-500 text-amber-950"
                >
                  <ClipboardList className="h-4 w-4" />
                  Lag pakkseddel
                </Button>
              ) : null}
              {onCopyOrder ? (
                <Button variant="outline" size="sm" onClick={onCopyOrder} disabled={order.lines.length === 0}>
                  <Copy className="h-4 w-4" />
                  Kopiere ordren
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Ferdig
              </Button>
              {!readOnly ? (
                rulesPreview.blocks.length > 0 && hasOrdreWrite ? (
                  <Button size="sm" variant="brand" onClick={() => setOverrideOpen(true)} disabled={savingAll}>
                    Overstyr …
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => saveAll()}
                    disabled={dirtyCount === 0 || savingAll || rulesPreview.blocks.length > 0}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {savingAll ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Lagre{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
                  </Button>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
      <OrderInfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        orderId={order?.id ?? null}
        readOnly={readOnly}
        legalEntityId={(order as any)?.legal_entity_id ?? null}
      />
      <OverrideRuleDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        blocks={rulesPreview.blocks}
        contextLine={customer && date ? `${customer.display_name} · ${date}` : undefined}
        submitting={savingAll}
        onConfirm={async (reason) => {
          setOverrideOpen(false);
          await saveAll(reason);
        }}
      />
    </Dialog>
  );
}
