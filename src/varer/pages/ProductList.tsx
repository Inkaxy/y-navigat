import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner, NewProductActionButton } from "@/varer/components/layout/AppHeaderBanner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QuickCreateProductDialog } from "@/varer/components/products/QuickCreateProductDialog";
import { BulkImageUploadDialog } from "@/varer/components/products/BulkImageUploadDialog";
import { ColumnPicker, type ColumnOption } from "@/varer/components/products/ColumnPicker";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Tag, Cake, Images, ImageIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRODUCT_STATUS_LABEL, ProductStatus, CAKE_ROLE_LABEL, CakeRole, LABEL_MODE_OPTIONS } from "@/varer/lib/constants";
import { useAppContext } from "@/varer/context/AppContext";
import { useUiPreference } from "@/hooks/useUiPreference";

type ProductRow = {
  id: string;
  display_number: number;
  code: string;
  display_name: string;
  product_category: string;
  product_subcategory: string | null;
  main_category: { code: string; display_name: string } | null;
  sub_category: { code: string; display_name: string } | null;
  unit_of_sale: string;
  status: ProductStatus;
  variant_of_product_id: string | null;
  variant_label: string | null;
  label_mode: string | null;
  is_cake_component: boolean | null;
  cake_role: CakeRole | null;
  image_url: string | null;
  mva_rate?: number | null;
};

const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-success/15 text-success border-success/30",
  draft: "bg-muted text-muted-foreground border-border",
  paused: "bg-warning/15 text-warning border-warning/30",
  discontinued: "bg-destructive/10 text-destructive border-destructive/30",
};

const LABEL_MODE_LABEL: Record<string, string> = Object.fromEntries(
  LABEL_MODE_OPTIONS.map((o) => [o.value, o.label]),
);

type ColDef = ColumnOption & {
  headerClassName?: string;
  cellClassName?: string;
  render: (
    p: ProductRow,
    ctx: { parent: ProductRow | null; price: number | undefined },
  ) => React.ReactNode;
};

const COLUMN_PREF_SCOPE = "varer.product_list.columns.v1";

export default function ProductList() {
  const navigate = useNavigate();
  const { canWrite, legalEntityId } = useAppContext();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [variantFilter, setVariantFilter] = useState<string>("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bulkImagesOpen, setBulkImagesOpen] = useState(false);

  const productsQuery = useQuery({
    queryKey: ["products", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, display_number, code, display_name, product_category, product_subcategory, unit_of_sale, status, variant_of_product_id, variant_label, label_mode, is_cake_component, cake_role, image_url, mva_rate, main_category:product_main_categories(code, display_name), sub_category:product_sub_categories(code, display_name)",
        )
        .eq("legal_entity_id", legalEntityId)
        .order("display_number", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const all = productsQuery.data ?? [];
  const parentMap = useMemo(() => {
    const m = new Map<string, ProductRow>();
    all.forEach((p) => m.set(p.id, p));
    return m;
  }, [all]);

  const categories = useMemo(() => {
    const set = new Set(all.map((p) => p.product_category).filter(Boolean));
    return Array.from(set).sort();
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rangeMatch = q.match(/^(\d+)\s*-\s*(\d+)$/);
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);
      rangeFrom = Math.min(a, b);
      rangeTo = Math.max(a, b);
    }
    const numberList = !rangeMatch && /^[\d\s,]+$/.test(q) && /[,\s]/.test(q)
      ? q.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
      : null;

    return all.filter((p) => {
      if (q) {
        if (rangeFrom !== null && rangeTo !== null) {
          if (p.display_number < rangeFrom || p.display_number > rangeTo) return false;
        } else if (numberList && numberList.length > 0) {
          if (!numberList.includes(p.display_number)) return false;
        } else if (
          !`${p.display_name} ${p.code} ${p.display_number}`.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (category !== "all" && p.product_category !== category) return false;
      if (status !== "all" && p.status !== status) return false;
      if (variantFilter === "parents" && p.variant_of_product_id) return false;
      if (variantFilter === "variants" && !p.variant_of_product_id) return false;
      return true;
    });
  }, [all, search, category, status, variantFilter]);

  const defaultPriceList = useQuery({
    queryKey: ["default-pricelist", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("price_lists")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId)
        .eq("is_default", true)
        .maybeSingle();
      return data;
    },
  });

  const priceItems = useQuery({
    queryKey: ["pricelist-items", defaultPriceList.data?.id],
    enabled: !!defaultPriceList.data?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("price_list_items")
        .select("product_id, price, valid_from, valid_to")
        .eq("price_list_id", defaultPriceList.data!.id);
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    (priceItems.data ?? []).forEach((it: any) => {
      if (it.valid_from > today) return;
      if (it.valid_to && it.valid_to < today) return;
      m.set(it.product_id, Number(it.price));
    });
    return m;
  }, [priceItems.data]);

  // ---- Kolonne-konfig ----
  const columns: ColDef[] = useMemo(
    () => [
      {
        key: "number",
        label: "Nr",
        fixed: true,
        headerClassName: "w-16",
        cellClassName: "text-muted-foreground tabular-nums",
        render: (p) => p.display_number,
      },
      {
        key: "image",
        label: "Bilde",
        cellClassName: "w-12",
        headerClassName: "w-12",
        render: (p) =>
          p.image_url ? (
            <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
            </div>
          ),
      },
      {
        key: "name",
        label: "Navn",
        fixed: true,
        render: (p) => {
          const isVariant = !!p.variant_of_product_id;
          return (
            <div className={isVariant ? "pl-5 italic" : "font-medium"}>
              <span className="inline-flex items-center gap-1.5">
                {p.display_name}
                {p.label_mode && p.label_mode !== "none" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Tag className="h-3.5 w-3.5 text-app shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>Etikett aktivert</TooltipContent>
                  </Tooltip>
                )}
                {p.is_cake_component && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Cake className="h-3.5 w-3.5 text-app shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Kakebygger-byggekloss
                      {p.cake_role ? `: ${CAKE_ROLE_LABEL[p.cake_role]}` : ""}
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
              {p.variant_label && (
                <span className="ml-2 text-xs text-muted-foreground">({p.variant_label})</span>
              )}
            </div>
          );
        },
      },
      {
        key: "code",
        label: "Varekode",
        cellClassName: "text-muted-foreground tabular-nums",
        render: (p) => p.code || "—",
      },
      {
        key: "variant_of",
        label: "Variant av",
        cellClassName: "text-muted-foreground",
        render: (_p, ctx) => ctx.parent?.display_name ?? "—",
      },
      { key: "category", label: "Kategori", render: (p) => p.product_category },
      {
        key: "subcategory",
        label: "Underkategori",
        cellClassName: "text-muted-foreground",
        render: (p) => p.product_subcategory ?? "—",
      },
      { key: "unit", label: "Salgsenhet", render: (p) => p.unit_of_sale },
      {
        key: "price",
        label: "Pris",
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
        render: (_p, ctx) =>
          ctx.price !== undefined ? `kr ${ctx.price.toFixed(2)}` : <span className="text-muted-foreground">—</span>,
      },
      {
        key: "mva",
        label: "MVA",
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums text-muted-foreground",
        render: (p) => (p.mva_rate != null ? `${p.mva_rate}%` : "—"),
      },
      {
        key: "label_mode",
        label: "Etikett",
        cellClassName: "text-muted-foreground",
        render: (p) => (p.label_mode ? LABEL_MODE_LABEL[p.label_mode] ?? p.label_mode : "—"),
      },
      {
        key: "cake_role",
        label: "Kakebygger",
        cellClassName: "text-muted-foreground",
        render: (p) => (p.cake_role ? CAKE_ROLE_LABEL[p.cake_role] : "—"),
      },
      {
        key: "status",
        label: "Status",
        fixed: true,
        render: (p) => (
          <Badge variant="outline" className={STATUS_BADGE[p.status]}>
            {PRODUCT_STATUS_LABEL[p.status]}
          </Badge>
        ),
      },
    ],
    [],
  );

  const DEFAULT_VISIBLE = ["variant_of", "category", "unit", "price"];
  const { value: pref, setValue: setPref } = useUiPreference<{ visible: string[] }>(
    COLUMN_PREF_SCOPE,
    { visible: DEFAULT_VISIBLE },
  );
  const visibleSet = new Set(pref.visible ?? DEFAULT_VISIBLE);
  const visibleCols = columns.filter((c) => c.fixed || visibleSet.has(c.key));
  const colCount = visibleCols.length;

  const pickerOptions: ColumnOption[] = columns.map((c) => ({
    key: c.key,
    label: c.label,
    fixed: c.fixed,
  }));

  return (
    <>
      <AppHeaderBanner
        actions={canWrite && (
          <NewProductActionButton onClick={() => setWizardOpen(true)} />
        )}
      />

      <div className="px-6 py-6">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Søk i navn, kode, nr eller range (f.eks. 1791-1800)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle kategorier</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="paused">På pause</SelectItem>
                <SelectItem value="discontinued">Utgått</SelectItem>
                <SelectItem value="draft">Utkast</SelectItem>
              </SelectContent>
            </Select>

            <Select value={variantFilter} onValueChange={setVariantFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Varianter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="parents">Kun mor-varer</SelectItem>
                <SelectItem value="variants">Kun varianter</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-3">
              <ColumnPicker
                columns={pickerOptions}
                visible={pref.visible ?? DEFAULT_VISIBLE}
                onChange={(next) => setPref({ visible: next })}
                onReset={() => setPref({ visible: DEFAULT_VISIBLE })}
              />
              {canWrite && (
                <Button variant="outline" size="sm" onClick={() => setBulkImagesOpen(true)} className="gap-1.5">
                  <Images className="h-4 w-4" /> Massimport bilder
                </Button>
              )}
              <span className="text-sm text-muted-foreground">{filtered.length} treff</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {visibleCols.map((c) => (
                    <th
                      key={c.key}
                      className={`px-4 py-2.5 text-left font-medium ${c.headerClassName ?? ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productsQuery.isLoading && (
                  <tr><td colSpan={colCount} className="py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </td></tr>
                )}
                {!productsQuery.isLoading && filtered.length === 0 && (
                  <tr><td colSpan={colCount} className="py-16 text-center text-muted-foreground">
                    {all.length === 0 ? (
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">Ingen varer ennå</div>
                        <div className="text-sm">Klikk «Ny vare» øverst til høyre for å komme i gang.</div>
                      </div>
                    ) : "Ingen treff for valgte filtre"}
                  </td></tr>
                )}
                {filtered.map((p) => {
                  const parent = p.variant_of_product_id ? parentMap.get(p.variant_of_product_id) ?? null : null;
                  const price = priceMap.get(p.id);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/varer/vareliste/${p.id}`)}
                      className="cursor-pointer border-t border-border hover:bg-muted/30"
                    >
                      {visibleCols.map((c) => (
                        <td key={c.key} className={`px-4 py-2.5 ${c.cellClassName ?? ""}`}>
                          {c.render(p, { parent, price })}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <QuickCreateProductDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        productOptions={all.map((p) => ({
          id: p.id,
          display_name: p.display_name,
          display_number: p.display_number,
          code: p.code,
        }))}
      />

      <BulkImageUploadDialog
        open={bulkImagesOpen}
        onOpenChange={setBulkImagesOpen}
        products={all.map((p) => ({
          id: p.id,
          display_name: p.display_name,
          display_number: p.display_number,
          code: p.code,
          image_url: p.image_url,
        }))}
        onComplete={() => productsQuery.refetch()}
      />
    </>
  );
}
