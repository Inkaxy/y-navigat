/**
 * Spesialpriser-side — liste + filtre + CRUD via SpecialPriceDialog.
 *
 * Hierarki for prisbestemmelse er definert i public.get_effective_price().
 * Denne UI-en lar deg administrere rader i public.special_prices.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Tag,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";

import { logAudit } from "@/varer/lib/audit";
import { useAppContext } from "@/varer/context/AppContext";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { formatKr, downloadCsv, toCsv } from "@/varer/lib/pricing";
import { SpecialPriceDialog, type SpecialPriceRow } from "@/varer/components/prices/SpecialPriceDialog";
import { osloTodayISO, osloDateISO } from "@/lib/osloDate";

type ProductLite = { id: string; display_number: number; display_name: string; code: string };
type CustomerLite = { id: string; customer_number: string; display_name: string };
type PriceListLite = { id: string; display_name: string };

const ALL = "__all__";
const WEEKDAY_LABEL = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

type StatusFilter = "active" | "expired" | "future" | "all";

export default function SpecialPrices() {
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();

  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState<string>(ALL);
  const [filterProduct, setFilterProduct] = useState<string>(ALL);
  const [filterPriceList, setFilterPriceList] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [showOlder, setShowOlder] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SpecialPriceRow | null>(null);
  const [deleting, setDeleting] = useState<SpecialPriceRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);

  // Lookups
  const productsQuery = useQuery({
    queryKey: ["sp-products", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, display_name, code")
        .eq("legal_entity_id", legalEntityId)
        .order("display_number");
      if (error) throw error;
      return (data ?? []) as ProductLite[];
    },
  });

  const customersQuery = useQuery({
    queryKey: ["sp-customers", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_number, display_name")
        .eq("legal_entity_id", legalEntityId)
        .order("customer_number");
      if (error) throw error;
      return (data ?? []) as CustomerLite[];
    },
  });

  const priceListsQuery = useQuery({
    queryKey: ["sp-pricelists", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId)
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as PriceListLite[];
    },
  });

  const specialPricesQuery = useQuery({
    queryKey: ["special-prices", legalEntityId],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("special_prices")
          .select(
            "id, product_id, customer_id, price_list_id, valid_from, valid_to, weekday, precedence_over_weekday, price, is_net_price, notes, created_at",
          )
          .eq("legal_entity_id", legalEntityId)
          .order("valid_from", { ascending: false, nullsFirst: false })
          .range(from, to),
      );
      return data as (SpecialPriceRow & { created_at: string })[];
    },
  });

  const productMap = useMemo(() => {
    const m = new Map<string, ProductLite>();
    for (const p of productsQuery.data ?? []) m.set(p.id, p);
    return m;
  }, [productsQuery.data]);

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerLite>();
    for (const c of customersQuery.data ?? []) m.set(c.id, c);
    return m;
  }, [customersQuery.data]);

  const priceListMap = useMemo(() => {
    const m = new Map<string, PriceListLite>();
    for (const pl of priceListsQuery.data ?? []) m.set(pl.id, pl);
    return m;
  }, [priceListsQuery.data]);

  // Filtrert visning
  const filtered = useMemo(() => {
    const today = osloTodayISO();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = osloDateISO(oneYearAgo);

    return (specialPricesQuery.data ?? []).filter((sp) => {
      // Status-filter
      if (statusFilter === "active") {
        if (sp.valid_from && sp.valid_from > today) return false;
        if (sp.valid_to && sp.valid_to < today) return false;
      } else if (statusFilter === "expired") {
        if (!sp.valid_to || sp.valid_to >= today) return false;
      } else if (statusFilter === "future") {
        if (!sp.valid_from || sp.valid_from <= today) return false;
      }

      // Vis-eldre toggle: skjul rader som utløp for mer enn 1 år siden
      if (!showOlder && sp.valid_to && sp.valid_to < cutoff) return false;

      if (filterCustomer !== ALL) {
        if (filterCustomer === "__none__customer") {
          if (sp.customer_id) return false;
        } else if (sp.customer_id !== filterCustomer) return false;
      }
      if (filterProduct !== ALL && sp.product_id !== filterProduct) return false;
      if (filterPriceList !== ALL) {
        if (filterPriceList === "__none__pricelist") {
          if (sp.price_list_id) return false;
        } else if (sp.price_list_id !== filterPriceList) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const product = productMap.get(sp.product_id);
        const customer = sp.customer_id ? customerMap.get(sp.customer_id) : null;
        const hay = [
          product?.display_name,
          product?.code,
          String(product?.display_number ?? ""),
          customer?.display_name,
          customer?.customer_number,
          sp.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    specialPricesQuery.data,
    statusFilter,
    showOlder,
    filterCustomer,
    filterProduct,
    filterPriceList,
    search,
    productMap,
    customerMap,
  ]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: SpecialPriceRow) {
    setEditing(row);
    setDialogOpen(true);
  }

  async function confirmDelete() {
    if (!deleting) return;
    const product = productMap.get(deleting.product_id);
    const expectedName = product?.display_name ?? "";
    if (deleteConfirm.trim() !== expectedName) {
      toast.error("Skriv varenavnet nøyaktig for å bekrefte");
      return;
    }
    setDeleteSaving(true);
    const { error } = await supabase.from("special_prices").delete().eq("id", deleting.id);
    setDeleteSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const customer = deleting.customer_id ? customerMap.get(deleting.customer_id) : null;
    await logAudit({
      action: "delete",
      entity_type: "special_price",
      entity_id: deleting.id,
      entity_display_reference: `${expectedName}${customer ? ` — ${customer.display_name}` : ""} — ${deleting.valid_from ?? ""}`,
    });
    toast.success("Spesialpris slettet");
    qc.invalidateQueries({ queryKey: ["special-prices"] });
    qc.invalidateQueries({ queryKey: ["matrix-special-flags"] });
    setDeleting(null);
    setDeleteConfirm("");
  }

  function exportCsv() {
    const header = [
      "Varenr",
      "Vare",
      "Tilbudsprisliste",
      "Kundenr",
      "Kunde",
      "Fra dato",
      "Til dato",
      "Ukedag",
      "Foran ukedager",
      "Pris",
      "Nettopris",
      "Notater",
    ];
    const rows = filtered.map((sp) => {
      const p = productMap.get(sp.product_id);
      const c = sp.customer_id ? customerMap.get(sp.customer_id) : null;
      const pl = sp.price_list_id ? priceListMap.get(sp.price_list_id) : null;
      return [
        p?.display_number ?? "",
        p?.display_name ?? "",
        pl?.display_name ?? "",
        c?.customer_number ?? "",
        c?.display_name ?? "",
        sp.valid_from ?? "",
        sp.valid_to ?? "",
        sp.weekday == null ? "Alle" : WEEKDAY_LABEL[sp.weekday],
        sp.precedence_over_weekday ? "Ja" : "",
        sp.price,
        sp.is_net_price ? "Ja" : "",
        sp.notes ?? "",
      ];
    });
    downloadCsv(`spesialpriser_${osloTodayISO()}.csv`, toCsv([header, ...rows]));
    toast.success("CSV eksportert");
  }

  const loading =
    specialPricesQuery.isLoading ||
    productsQuery.isLoading ||
    customersQuery.isLoading ||
    priceListsQuery.isLoading;

  return (
    <>
      <AppHeaderBanner
        title="Spesialpriser"
        subtitle="Kunde- og prisliste-spesifikke priser med ukedags-overstyring"
        actions={
          canWrite && (
            <Button
              size="sm"
              className="bg-white text-app-dark hover:bg-white/90"
              onClick={openNew}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Ny spesialpris
            </Button>
          )
        }
      />

      <div className="space-y-4 px-6 py-6">
        {/* Toolbar */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Søk vare, kunde, notater…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <Select value={filterProduct} onValueChange={setFilterProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Vare" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alle varer</SelectItem>
                  {(productsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      #{p.display_number} · {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                <SelectTrigger>
                  <SelectValue placeholder="Kunde" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alle kunder</SelectItem>
                  <SelectItem value="__none__customer">— Generelle (uten kunde) —</SelectItem>
                  {(customersQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.customer_number} · {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterPriceList} onValueChange={setFilterPriceList}>
                <SelectTrigger>
                  <SelectValue placeholder="Prisliste" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alle prislister</SelectItem>
                  <SelectItem value="__none__pricelist">— Uten prisliste —</SelectItem>
                  {(priceListsQuery.data ?? []).map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <RadioGroup
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                className="flex flex-wrap gap-3"
              >
                {(
                  [
                    { v: "active", l: "Aktive" },
                    { v: "future", l: "Fremtidige" },
                    { v: "expired", l: "Utløpte" },
                    { v: "all", l: "Alle" },
                  ] as const
                ).map((opt) => (
                  <div key={opt.v} className="flex items-center gap-1.5">
                    <RadioGroupItem id={`st-${opt.v}`} value={opt.v} />
                    <Label htmlFor={`st-${opt.v}`} className="cursor-pointer text-sm font-normal">
                      {opt.l}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-older"
                    checked={showOlder}
                    onCheckedChange={setShowOlder}
                  />
                  <Label htmlFor="show-older" className="cursor-pointer text-sm">
                    Vis eldre priser
                  </Label>
                </div>
                <span className="text-sm text-muted-foreground">{filtered.length} treff</span>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
                  <Download className="mr-1.5 h-4 w-4" /> CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabell */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="space-y-3 py-12 text-center text-sm text-muted-foreground">
                <Tag className="mx-auto h-8 w-8 opacity-40" />
                <div>Ingen spesialpriser matcher filtrene.</div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vare</TableHead>
                    <TableHead>Tilbudsprisliste</TableHead>
                    <TableHead>Kunde</TableHead>
                    <TableHead className="w-[110px]">Fra dato</TableHead>
                    <TableHead className="w-[110px]">Til dato</TableHead>
                    <TableHead className="w-[100px]">Ukedag</TableHead>
                    <TableHead className="w-[110px] text-center">Foran ukedager</TableHead>
                    <TableHead className="w-[100px] text-right">Pris</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((sp) => {
                    const p = productMap.get(sp.product_id);
                    const c = sp.customer_id ? customerMap.get(sp.customer_id) : null;
                    const pl = sp.price_list_id ? priceListMap.get(sp.price_list_id) : null;
                    return (
                      <TableRow key={sp.id}>
                        <TableCell className="font-medium">
                          {p ? (
                            <>
                              <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                                #{p.display_number}
                              </span>
                              {p.display_name}
                            </>
                          ) : (
                            <span className="italic text-muted-foreground">Slettet vare</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {pl?.display_name ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {c ? (
                            <>
                              <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">
                                {c.customer_number}
                              </span>
                              {c.display_name}
                            </>
                          ) : (
                            <span className="text-muted-foreground">— Alle —</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{sp.valid_from ?? "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">{sp.valid_to ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {sp.weekday == null ? (
                            <span className="text-muted-foreground">Alle</span>
                          ) : (
                            WEEKDAY_LABEL[sp.weekday]
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {sp.precedence_over_weekday && (
                            <Check className="mx-auto h-4 w-4 text-app" />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatKr(sp.price)}
                          {sp.is_net_price && (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">
                              netto
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(sp)}
                              disabled={!canWrite}
                              aria-label="Rediger"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setDeleteConfirm("");
                                setDeleting(sp);
                              }}
                              disabled={!canWrite}
                              aria-label="Slett"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <SpecialPriceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        products={productsQuery.data ?? []}
        customers={customersQuery.data ?? []}
        priceLists={priceListsQuery.data ?? []}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["special-prices"] });
          qc.invalidateQueries({ queryKey: ["matrix-special-flags"] });
        }}
      />

      {/* Slett-bekreftelse */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slett spesialpris?</DialogTitle>
            <DialogDescription>
              Skriv inn varenavnet for å bekrefte. Handlingen kan ikke angres.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium">
                  {productMap.get(deleting.product_id)?.display_name ?? "?"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {deleting.customer_id
                    ? customerMap.get(deleting.customer_id)?.display_name
                    : "Alle kunder"}
                  {" · "}
                  {deleting.valid_from ?? "?"} → {deleting.valid_to ?? "∞"}
                  {" · "}
                  {formatKr(deleting.price)} kr
                </div>
              </div>
              <Input
                placeholder={`Skriv "${productMap.get(deleting.product_id)?.display_name ?? ""}" for å bekrefte`}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteSaving}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={
                deleteSaving ||
                !deleting ||
                deleteConfirm !== (productMap.get(deleting.product_id)?.display_name ?? "")
              }
            >
              {deleteSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
