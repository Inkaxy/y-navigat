import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNBCustomers } from "@/ordre/hooks/useNBCustomers";
import { useNBProducts } from "@/ordre/hooks/useNBProducts";
import { useProductsByIds } from "@/ordre/hooks/useProductsByIds";
import { useDeliveryTours, sortToursByPriority } from "@/ordre/hooks/useDeliveryTours";
import {
  WEEKDAY_SHORT,
  WEEKDAY_LONG,
  useRecurringScheduleDetail,
  useSaveRecurringSchedule,
  useDuplicateRecurringSchedule,
  type RecurringScheduleWithCustomer,
} from "@/ordre/hooks/useRecurringOrders";
import { cn } from "@/lib/utils";

type Editing = RecurringScheduleWithCustomer | null;

type DraftItem = {
  id?: string;
  product_id: string;
  weekday: number;
  tour_id: string | null;
  quantity: number;
  notes: string | null;
};

/** Én rad i ukesvisning: ett produkt (+ tur) med mengder for hver ukedag */
type WeekRow = {
  product_id: string;
  tour_id: string | null;
  // weekday (1-7) -> { id?, quantity, notes }
  cells: Record<number, { id?: string; quantity: number; notes: string | null }>;
};

export function RecurringScheduleDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
  lockedCustomer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Editing;
  onSaved: () => void;
  lockedCustomer?: { id: string; label: string } | null;
}) {
  const isEdit = !!editing;
  const isLocked = !isEdit && !!lockedCustomer;
  const { data: detail, isLoading: loadingDetail } = useRecurringScheduleDetail(
    editing?.id ?? null,
  );

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string>("");
  const [name, setName] = useState("Fastordre");
  const [isActive, setIsActive] = useState(true);
  const [validFrom, setValidFrom] = useState<string>("");
  const [validTo, setValidTo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [rows, setRows] = useState<WeekRow[]>([]);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const { data: customers = [] } = useNBCustomers(customerSearch);

  const [productSearch, setProductSearch] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  // Hent kundens prisliste — useNBProducts krever priceListId for å vise produkter
  const { data: customerPriceListId = null } = useQuery({
    queryKey: ["recurring-customer-price-list", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("default_price_list_id")
        .eq("id", customerId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.default_price_list_id as string | null) ?? null;
    },
  });
  const { data: searchedProducts = [] } = useNBProducts(productSearch, customerPriceListId);
  // Vi trenger også full liste for å vise navn/nummer på allerede valgte produkter
  const { data: allProducts = [] } = useNBProducts(undefined, customerPriceListId);
  const { data: tours = [] } = useDeliveryTours({ activeOnly: true });
  const sortedTours = useMemo(() => sortToursByPriority(tours), [tours]);
  const rowProductIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.product_id))),
    [rows],
  );
  const { data: rowProducts = [] } = useProductsByIds(rowProductIds);
  const productMap = useMemo(() => {
    const m = new Map<string, { name: string; number: number; code: string }>();
    allProducts.forEach((p) =>
      m.set(p.id, { name: p.display_name, number: p.display_number, code: p.code }),
    );
    searchedProducts.forEach((p) =>
      m.set(p.id, { name: p.display_name, number: p.display_number, code: p.code }),
    );
    rowProducts.forEach((p) =>
      m.set(p.id, { name: p.display_name, number: p.display_number, code: p.code }),
    );
    return m;
  }, [searchedProducts, allProducts, rowProducts]);

  const save = useSaveRecurringSchedule();
  const duplicate = useDuplicateRecurringSchedule();

  const topAddRef = useRef<HTMLDivElement | null>(null);
  const [showFab, setShowFab] = useState(false);
  useEffect(() => {
    if (!open) return;
    const el = topAddRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setShowFab(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-40px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open, rows.length]);

  async function handleDuplicate() {
    if (!editing) return;
    try {
      const { scheduleId } = await duplicate.mutateAsync(editing.id);
      toast.success(`Kopi opprettet — «${editing.name} (kopi)» (inaktiv)`);
      onSaved();
      onOpenChange(false);
      void scheduleId;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke kopiere mal");
    }
  }

  // Init/reset på open
  useEffect(() => {
    if (!open) return;
    if (isEdit && editing) {
      setCustomerId(editing.customer_id);
      setCustomerLabel(editing.customer_display_name);
      setName(editing.name);
      setIsActive(editing.is_active);
      setValidFrom(editing.valid_from ?? "");
      setValidTo(editing.valid_to ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setCustomerId(lockedCustomer?.id ?? null);
      setCustomerLabel(lockedCustomer?.label ?? "");
      setName("");
      setIsActive(true);
      setValidFrom("");
      setValidTo("");
      setNotes("");
      setRows([]);
    }
  }, [open, isEdit, editing, lockedCustomer]);

  // Last linjer fra detail og grupper til ukesrader
  useEffect(() => {
    if (!detail) return;
    const grouped = new Map<string, WeekRow>();
    for (const i of detail.items) {
      const key = `${i.product_id}::${i.tour_id ?? ""}`;
      let row = grouped.get(key);
      if (!row) {
        row = { product_id: i.product_id, tour_id: i.tour_id, cells: {} };
        grouped.set(key, row);
      }
      row.cells[i.weekday] = {
        id: i.id,
        quantity: Number(i.quantity),
        notes: i.notes,
      };
    }
    setRows(Array.from(grouped.values()));
  }, [detail]);

  function addProductRow(product_id: string) {
    setRows((prev) => {
      // Hvis produktet allerede finnes uten tur — ikke dupliser
      if (prev.some((r) => r.product_id === product_id && r.tour_id === null)) {
        return prev;
      }
      return [...prev, { product_id, tour_id: null, cells: {} }];
    });
  }

  function updateRowTour(idx: number, tour_id: string | null) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, tour_id } : r)));
  }

  function updateCell(idx: number, weekday: number, quantity: number) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const cells = { ...r.cells };
        if (!quantity || quantity <= 0) {
          // Behold id hvis det fantes (slik at hooken kan slette) — men marker quantity = 0
          if (cells[weekday]) {
            cells[weekday] = { ...cells[weekday], quantity: 0 };
          } else {
            delete cells[weekday];
          }
        } else {
          cells[weekday] = {
            id: cells[weekday]?.id,
            quantity,
            notes: cells[weekday]?.notes ?? null,
          };
        }
        return { ...r, cells };
      }),
    );
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Konverter rader → flate items for lagring */
  function flattenRows(): DraftItem[] {
    const items: DraftItem[] = [];
    for (const r of rows) {
      for (const wdStr of Object.keys(r.cells)) {
        const wd = Number(wdStr);
        const c = r.cells[wd];
        if (!c || !c.quantity || c.quantity <= 0) continue;
        items.push({
          id: c.id,
          product_id: r.product_id,
          weekday: wd,
          tour_id: r.tour_id,
          quantity: c.quantity,
          notes: c.notes,
        });
      }
    }
    return items;
  }

  async function handleSave() {
    if (!customerId) {
      toast.error("Velg kunde");
      return;
    }
    const items = flattenRows();
    if (items.length === 0) {
      toast.error("Legg til minst én mengde");
      return;
    }
    try {
      await save.mutateAsync({
        id: editing?.id,
        customer_id: customerId,
        name: name.trim() || "Fastordre",
        is_active: isActive,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        notes: notes.trim() || null,
        items: items.map((i) => ({
          id: i.id,
          product_id: i.product_id,
          weekday: i.weekday,
          tour_id: i.tour_id,
          quantity: i.quantity,
          notes: i.notes,
        })),
      });
      toast.success(isEdit ? "Fastordre oppdatert" : "Fastordre opprettet");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunne ikke lagre fastordre";
      if (msg.includes("recurring_order_items_unique")) {
        toast.error(
          "To linjer har samme produkt + ukedag + tur. Slå sammen eller endre tur.",
        );
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 gap-0 grid-rows-[auto_1fr_auto] max-h-[calc(100dvh-2rem)] h-[min(90dvh,900px)] overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle>
            {isEdit ? `Rediger fastordre — ${editing?.customer_display_name}` : "Ny fastordre"}
          </DialogTitle>
          <DialogDescription>
            En fastordre er en ukentlig mal som beskriver hva en kunde normalt mottar.
            Fastordre materialiseres ved hovedkjøring av pakksedler og ved lagring i
            leveringskalenderen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto overscroll-contain px-6 py-4 relative">
          {/* Kunde + meta */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Kunde</Label>
              {isEdit || isLocked ? (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {customerLabel}
                </div>
              ) : (
                <Popover open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start font-normal"
                    >
                      {customerLabel || "Velg kunde …"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Søk kunde …"
                        value={customerSearch}
                        onValueChange={setCustomerSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Ingen treff</CommandEmpty>
                        <CommandGroup>
                          {customers.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.id}
                              onSelect={() => {
                                setCustomerId(c.id);
                                setCustomerLabel(c.display_name);
                                setCustomerPickerOpen(false);
                              }}
                            >
                              <span className="text-muted-foreground tabular-nums mr-2">
                                {c.customer_number}
                              </span>
                              {c.display_name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="rec-name">Navn på mal</Label>
              <Input
                id="rec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="F.eks. «Sommer», «Helg», «Standard» …"
              />
              <p className="text-xs text-muted-foreground">Gi malen et beskrivende navn så det er enkelt å skille flere maler.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="rec-from">Gyldig fra</Label>
                {validFrom && (
                  <button
                    type="button"
                    onClick={() => setValidFrom("")}
                    className="text-xs text-muted-foreground hover:text-brand-bronze"
                  >
                    Fjern
                  </button>
                )}
              </div>
              <Input
                id="rec-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Tom = ingen startdato (gjelder fra alltid)</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="rec-to">Gyldig til</Label>
                {validTo && (
                  <button
                    type="button"
                    onClick={() => setValidTo("")}
                    className="text-xs text-muted-foreground hover:text-brand-bronze"
                  >
                    Fjern
                  </button>
                )}
              </div>
              <Input
                id="rec-to"
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Tom = ruller videre uten sluttdato</p>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="rec-notes">Merknad (intern)</Label>
              <Textarea
                id="rec-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="F.eks. spesielle instrukser …"
              />
            </div>

            <div className="md:col-span-2 flex items-center gap-3 rounded-md border p-3">
              <Switch
                id="rec-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="rec-active" className="cursor-pointer">
                Aktiv
              </Label>
              <span className="text-xs text-muted-foreground">
                En mal med snevrere <em>Gyldig fra/til</em> overstyrer grunnmalen helt i sin periode (f.eks. ferie- eller sesong-mal).
              </span>
            </div>

          </div>

          {/* Ukesvisning */}
          <div className="space-y-3">
            <div ref={topAddRef} className="flex items-center justify-between gap-3">
              <Label>Ukesvisning — mengde per ukedag</Label>
              <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Legg til produkt
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0" align="end">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Søk produkt (navn eller kode) …"
                      value={productSearch}
                      onValueChange={setProductSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Ingen treff</CommandEmpty>
                      <CommandGroup>
                        {searchedProducts.map((p) => {
                          const already = rows.some(
                            (r) => r.product_id === p.id && r.tour_id === null,
                          );
                          return (
                            <CommandItem
                              key={p.id}
                              value={p.id}
                              disabled={already}
                              onSelect={() => {
                                addProductRow(p.id);
                                setProductPickerOpen(false);
                                setProductSearch("");
                              }}
                            >
                              <span className="text-muted-foreground tabular-nums mr-2 w-12 inline-block">
                                {p.display_number}
                              </span>
                              <span className="flex-1">{p.display_name}</span>
                              {already && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  lagt til
                                </span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {loadingDetail && isEdit ? (
              <div className="grid place-items-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
                Ingen produkter ennå. Klikk «Legg til produkt» for å starte.
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Produkt</TableHead>
                      {WEEKDAY_SHORT.map((d, i) => (
                        <TableHead
                          key={d}
                          className="w-[78px] text-center"
                          title={WEEKDAY_LONG[i]}
                        >
                          {d}
                        </TableHead>
                      ))}
                      <TableHead className="w-[150px]">Tur</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => {
                      const meta = productMap.get(row.product_id);
                      return (
                        <TableRow key={`${row.product_id}-${row.tour_id ?? "none"}-${idx}`}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium leading-tight">
                                {meta?.name ?? "Ukjent produkt"}
                              </span>
                              {meta && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  #{meta.number} · {meta.code}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          {WEEKDAY_SHORT.map((_, i) => {
                            const wd = i + 1;
                            const cell = row.cells[wd];
                            const qty = cell?.quantity ?? 0;
                            return (
                              <TableCell key={wd} className="p-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={qty === 0 ? "" : qty}
                                  onChange={(e) =>
                                    updateCell(idx, wd, Number(e.target.value) || 0)
                                  }
                                  placeholder="—"
                                  className={cn(
                                    "h-8 text-center tabular-nums px-1",
                                    qty > 0 && "bg-primary/5 font-medium",
                                  )}
                                />
                              </TableCell>
                            );
                          })}
                          <TableCell>
                            <Select
                              value={row.tour_id ?? "__none__"}
                              onValueChange={(v) =>
                                updateRowTour(idx, v === "__none__" ? null : v)
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Ingen —</SelectItem>
                                {sortedTours.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.display_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => removeRow(idx)}
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              aria-label="Fjern produkt"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {rows.length > 0 && (
                    <TableBody>
                      <TableRow className="bg-muted/40">
                        <TableCell className="text-xs font-medium text-muted-foreground">
                          Sum per dag
                        </TableCell>
                        {WEEKDAY_SHORT.map((_, i) => {
                          const wd = i + 1;
                          const total = rows.reduce(
                            (acc, r) => acc + (r.cells[wd]?.quantity ?? 0),
                            0,
                          );
                          return (
                            <TableCell
                              key={wd}
                              className="text-center text-xs tabular-nums font-medium"
                            >
                              {total > 0 ? total : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  )}
                </Table>
              </div>
            )}
          </div>
          {/* Sticky FAB — vises når «Legg til produkt» øverst er ute av syne */}
          {showFab && rows.length > 0 && (
            <button
              type="button"
              onClick={() => setProductPickerOpen(true)}
              aria-label="Legg til produkt"
              title="Legg til produkt"
              className="sticky bottom-4 float-right mr-2 -mt-14 z-20 h-11 w-11 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20 hover:bg-primary/90 transition-transform hover:scale-105 flex items-center justify-center"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between px-6 py-3 border-t bg-background">
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:block">
              Endringer gjelder leveringer som ennå ikke er kjørt på pakkseddel.
            </span>
            {isEdit && (
              <Button
                variant="outline"
                onClick={handleDuplicate}
                disabled={duplicate.isPending || save.isPending}
                className="gap-1.5"
              >
                {duplicate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Dupliser som ny mal
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Lagre endringer" : "Opprett fastordre"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
