import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { parseNorwegianDecimal } from "@/varer/lib/norwegianNumber";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tag,
  Folders,
  Factory,
  FileText,
  Truck,
  Package,
  GitBranch,
  ChefHat,
  Receipt,
  ListChecks,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ScrollText,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import {
  productSchema,
  productToFormValues,
  formValuesToUpdatePayload,
  FIELD_TO_TAB,
  type ProductFormValues,
} from "@/varer/lib/productSchema";
import { logAudit } from "@/varer/lib/audit";
import { useAppContext } from "@/varer/context/AppContext";
import { ProductStatus } from "@/varer/lib/constants";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { DetailLayout } from "@/varer/components/products/detail/DetailLayout";
import type { TabConfig } from "@/varer/components/products/detail/TabNavItem";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { NavnOgNummerTab } from "@/varer/components/products/detail/tabs/NavnOgNummerTab";
import { KategoriseringTab } from "@/varer/components/products/detail/tabs/KategoriseringTab";
import { ProduksjonTab } from "@/varer/components/products/detail/tabs/ProduksjonTab";
import { VaredetaljerTab } from "@/varer/components/products/detail/tabs/VaredetaljerTab";
import { LeveranseTab } from "@/varer/components/products/detail/tabs/LeveranseTab";
import { PakkeTab, type PackageItem } from "@/varer/components/products/detail/tabs/PakkeTab";
import { ReturTab } from "@/varer/components/products/detail/tabs/ReturTab";
import { RecipeSummaryCard } from "@/varer/components/products/RecipeSummaryCard";
import { SelvStekingCard } from "@/varer/components/products/detail/SelvStekingCard";
import { DeclarationTab } from "@/varer/components/products/DeclarationTab";
import { CostPriceTab } from "@/varer/components/products/CostPriceTab";
import { CalculationTab } from "@/varer/components/products/CalculationTab";
import { StockTab } from "@/varer/components/products/StockTab";
import { useNavigate as useNav } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TABS: TabConfig[] = [
  { type: "tab", id: "navn", label: "Navn og nummer", icon: Tag },
  { type: "tab", id: "kategorisering", label: "Kategorisering", icon: Folders },
  { type: "tab", id: "produksjon", label: "Produksjon", icon: Factory },
  { type: "tab", id: "varedetaljer", label: "Varedetaljer", icon: FileText },
  { type: "tab", id: "leveranse", label: "Leveranse", icon: Truck },
  { type: "tab", id: "pakke", label: "Pakke", icon: Package },
  { type: "tab", id: "retur", label: "Retur", icon: RotateCcw },
  { type: "tab", id: "lager", label: "Lager", icon: Boxes },
  { type: "separator", id: "sep1" },
  { type: "tab", id: "varianter", label: "Varianter", icon: GitBranch },
  { type: "tab", id: "oppskrift", label: "Oppskrift", icon: ChefHat },
  { type: "tab", id: "deklarasjon", label: "Deklarasjon", icon: ScrollText },
  { type: "tab", id: "kalkyle_pris", label: "Kalkyle & pris", icon: Receipt },
  { type: "separator", id: "sep2" },
  { type: "tab", id: "sortiment", label: "Sortiment", icon: ListChecks },
  { type: "tab", id: "avvik", label: "Avvik", icon: AlertTriangle },
];

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") ?? "navn";
  // Gamle lenker til «Kalkyle» og «Priser» peker til den sammenslåtte fanen.
  const tab = rawTab === "kalkyle" || rawTab === "priser" ? "kalkyle_pris" : rawTab;
  const [saving, setSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [salesGroupIds, setSalesGroupIds] = useState<string[]>([]);
  const [originalSalesGroupIds, setOriginalSalesGroupIds] = useState<string[]>([]);
  const [originalKeywords, setOriginalKeywords] = useState<string[]>([]);
  const [packageItems, setPackageItems] = useState<PackageItem[]>([]);
  const [originalPackageItems, setOriginalPackageItems] = useState<PackageItem[]>([]);
  const [labelDepartmentIds, setLabelDepartmentIds] = useState<string[]>([]);
  const [originalLabelDepartmentIds, setOriginalLabelDepartmentIds] = useState<string[]>([]);
  const [cakeLinks, setCakeLinks] = useState<{ cake_step_id: string; cake_category_id: string }[]>([]);
  const [originalCakeLinks, setOriginalCakeLinks] = useState<{ cake_step_id: string; cake_category_id: string }[]>([]);

  const productQuery = useQuery({
    queryKey: ["product", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const lookupsQuery = useQuery({
    queryKey: ["product-lookups", legalEntityId],
    queryFn: async () => {
      const [main, sub, pages, sales, prod, le, allProducts, depts] = await Promise.all([
        supabase.from("product_main_categories").select("id, display_name").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
        supabase.from("product_sub_categories").select("id, display_name, main_category_id").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
        supabase.from("product_pages").select("id, display_name").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
        supabase.from("sales_groups").select("id, display_name").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
        supabase.from("production_groups").select("id, display_name").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
        supabase.from("legal_entities").select("gs1_prefix").eq("id", legalEntityId!).maybeSingle(),
        supabase.from("products").select("id, display_name, display_number, code").eq("legal_entity_id", legalEntityId!).order("display_number"),
        supabase.from("production_departments").select("id, code, display_name").eq("legal_entity_id", legalEntityId!).eq("status", "active").order("sort_order"),
      ]);
      return {
        mainCategories: main.data ?? [],
        subCategories: sub.data ?? [],
        productPages: pages.data ?? [],
        salesGroups: sales.data ?? [],
        productionGroups: prod.data ?? [],
        hasGs1Prefix: !!le.data?.gs1_prefix,
        allProducts: allProducts.data ?? [],
        productionDepartments: depts.data ?? [],
      };
    },
  });

  const junctionsQuery = useQuery({
    queryKey: ["product-junctions", id],
    enabled: !!id,
    queryFn: async () => {
      const [sg, pi, pld, csp] = await Promise.all([
        supabase.from("product_sales_groups").select("sales_group_id").eq("product_id", id!),
        supabase.from("product_package_items").select("contained_product_id, quantity, sort_order").eq("package_product_id", id!).order("sort_order"),
        supabase.from("product_label_departments").select("department_id").eq("product_id", id!),
        supabase.from("cake_step_products")
          .select("cake_step_id, cake_steps!inner(cake_category_id)")
          .eq("product_id", id!),
      ]);
      return {
        salesGroupIds: (sg.data ?? []).map((r) => r.sales_group_id),
        packageItems: (pi.data ?? []).map((r) => ({ contained_product_id: r.contained_product_id, quantity: Number(r.quantity) })),
        labelDepartmentIds: (pld.data ?? []).map((r: { department_id: string }) => r.department_id),
        cakeLinks: (csp.data ?? []).map((r: { cake_step_id: string; cake_steps: { cake_category_id: string } | { cake_category_id: string }[] }) => ({
          cake_step_id: r.cake_step_id,
          cake_category_id: Array.isArray(r.cake_steps) ? r.cake_steps[0]?.cake_category_id : r.cake_steps.cake_category_id,
        })),
      };
    },
  });

  const variantsQuery = useQuery({
    queryKey: ["product-variants", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, display_name, variant_label, status, display_number")
        .eq("variant_of_product_id", id!)
        .order("display_number");
      return data ?? [];
    },
  });

  const product = productQuery.data;

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: useMemo(
      () => (product ? productToFormValues(product) : undefined),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [product?.id],
    ),
  });

  // Sync form når product lastes
  useEffect(() => {
    if (product) {
      form.reset(productToFormValues(product));
      const kw = (product.keywords ?? []) as string[];
      setKeywords(kw);
      setOriginalKeywords(kw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.updated_at]);

  // Sync junctions
  useEffect(() => {
    if (junctionsQuery.data) {
      setSalesGroupIds(junctionsQuery.data.salesGroupIds);
      setOriginalSalesGroupIds(junctionsQuery.data.salesGroupIds);
      setPackageItems(junctionsQuery.data.packageItems);
      setOriginalPackageItems(junctionsQuery.data.packageItems);
      setLabelDepartmentIds(junctionsQuery.data.labelDepartmentIds);
      setOriginalLabelDepartmentIds(junctionsQuery.data.labelDepartmentIds);
      setCakeLinks(junctionsQuery.data.cakeLinks);
      setOriginalCakeLinks(junctionsQuery.data.cakeLinks);
    }
  }, [junctionsQuery.data]);

  const cakeLinksKey = (l: { cake_step_id: string }[]) =>
    JSON.stringify([...l].map((x) => x.cake_step_id).sort());

  const junctionsDirty =
    JSON.stringify([...salesGroupIds].sort()) !== JSON.stringify([...originalSalesGroupIds].sort()) ||
    JSON.stringify(packageItems) !== JSON.stringify(originalPackageItems) ||
    JSON.stringify(keywords) !== JSON.stringify(originalKeywords) ||
    JSON.stringify([...labelDepartmentIds].sort()) !== JSON.stringify([...originalLabelDepartmentIds].sort()) ||
    cakeLinksKey(cakeLinks) !== cakeLinksKey(originalCakeLinks);

  const isDirty = form.formState.isDirty || junctionsDirty;
  const unsavedGuard = useUnsavedChangesGuard(isDirty && !saving);

  // Beregn dirty/error tabs
  const dirtyTabs = useMemo(() => {
    const s = new Set<string>();
    Object.keys(form.formState.dirtyFields).forEach((k) => {
      const t = FIELD_TO_TAB[k as keyof ProductFormValues];
      if (t) s.add(t);
    });
    if (JSON.stringify([...salesGroupIds].sort()) !== JSON.stringify([...originalSalesGroupIds].sort())) s.add("kategorisering");
    if (JSON.stringify(packageItems) !== JSON.stringify(originalPackageItems)) s.add("pakke");
    if (JSON.stringify(keywords) !== JSON.stringify(originalKeywords)) s.add("varedetaljer");
    if (JSON.stringify([...labelDepartmentIds].sort()) !== JSON.stringify([...originalLabelDepartmentIds].sort())) s.add("produksjon");
    if (cakeLinksKey(cakeLinks) !== cakeLinksKey(originalCakeLinks)) s.add("produksjon");
    return s;
  }, [form.formState.dirtyFields, salesGroupIds, originalSalesGroupIds, packageItems, originalPackageItems, keywords, originalKeywords, labelDepartmentIds, originalLabelDepartmentIds, cakeLinks, originalCakeLinks]);

  const errorTabs = useMemo(() => {
    const s = new Set<string>();
    Object.keys(form.formState.errors).forEach((k) => {
      const t = FIELD_TO_TAB[k as keyof ProductFormValues];
      if (t) s.add(t);
    });
    return s;
  }, [form.formState.errors]);

  // Ctrl+S — MÅ ligge før alle conditional returns (Rules of Hooks)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && canWrite) handleSaveClick();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, canWrite]);

  if (productQuery.isLoading || !product) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function onSave(values: ProductFormValues) {
    if (!product) return;
    setSaving(true);
    const payload = { ...formValuesToUpdatePayload(values), keywords };
    const { error } = await supabase.from("products").update(payload as never).eq("id", product.id);
    if (error) { setSaving(false); toast.error(error.message); return; }

    // Diff sales_groups
    const toAdd = salesGroupIds.filter((id) => !originalSalesGroupIds.includes(id));
    const toRemove = originalSalesGroupIds.filter((id) => !salesGroupIds.includes(id));

    // Diff label_departments
    const ldToAdd = labelDepartmentIds.filter((id) => !originalLabelDepartmentIds.includes(id));
    const ldToRemove = originalLabelDepartmentIds.filter((id) => !labelDepartmentIds.includes(id));

    // Diff cake_step_products — basert på step_id
    const oldStepIds = new Set(originalCakeLinks.map((l) => l.cake_step_id));
    const newStepIds = new Set(cakeLinks.map((l) => l.cake_step_id));
    const cspToRemove = [...oldStepIds].filter((s) => !newStepIds.has(s));
    const cspToAdd = [...newStepIds].filter((s) => !oldStepIds.has(s));

    try {
      if (toRemove.length) {
        const { error: e } = await supabase.from("product_sales_groups").delete()
          .eq("product_id", product.id).in("sales_group_id", toRemove);
        if (e) throw e;
      }
      if (toAdd.length) {
        const { error: e } = await supabase.from("product_sales_groups").insert(
          toAdd.map((sgId) => ({ product_id: product.id, sales_group_id: sgId })) as never,
        );
        if (e) throw e;
      }

      // Pakkeinnhold: delete+insert i ÉN transaksjon (aldri tomt pakkeinnhold ved feil)
      if (JSON.stringify(packageItems) !== JSON.stringify(originalPackageItems)) {
        const { error: e } = await (supabase as any).rpc("replace_child_rows", {
          p_table: "product_package_items",
          p_parent_column: "package_product_id",
          p_parent_id: product.id,
          p_rows: packageItems.map((it, i) => ({
            package_product_id: product.id,
            contained_product_id: it.contained_product_id,
            quantity: it.quantity,
            sort_order: i,
          })),
        });
        if (e) throw e;
      }

      if (ldToRemove.length) {
        const { error: e } = await supabase.from("product_label_departments").delete()
          .eq("product_id", product.id).in("department_id", ldToRemove);
        if (e) throw e;
      }
      if (ldToAdd.length) {
        const { error: e } = await supabase.from("product_label_departments").insert(
          ldToAdd.map((dId) => ({ product_id: product.id, department_id: dId })) as never,
        );
        if (e) throw e;
      }

      if (cspToRemove.length) {
        const { error: e } = await supabase.from("cake_step_products").delete()
          .eq("product_id", product.id).in("cake_step_id", cspToRemove);
        if (e) throw e;
      }
      if (cspToAdd.length) {
        const { error: e } = await supabase.from("cake_step_products").insert(
          cspToAdd.map((sid) => ({ product_id: product.id, cake_step_id: sid })) as never,
        );
        if (e) throw e;
      }
    } catch (e) {
      setSaving(false);
      toast.error((e as Error).message ?? "Kunne ikke lagre koblinger");
      return;
    }


    await logAudit({
      action: "update",
      entity_type: "product",
      entity_id: product.id,
      entity_display_reference: values.display_name,
      changes: {
        fields: Object.keys(form.formState.dirtyFields),
        sales_groups_added: toAdd.length,
        sales_groups_removed: toRemove.length,
        label_departments_added: ldToAdd.length,
        label_departments_removed: ldToRemove.length,
        cake_step_products_added: cspToAdd.length,
        cake_step_products_removed: cspToRemove.length,
      },
    });

    toast.success("Lagret");
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["product-junctions", product.id] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  function handleSaveClick() {
    form.handleSubmit(
      (values) => onSave(values),
      (errors) => {
        const firstField = Object.keys(errors)[0];
        const firstTab = firstField ? FIELD_TO_TAB[firstField as keyof ProductFormValues] : null;
        if (firstTab) setParams({ tab: firstTab });
        toast.error("Det er valideringsfeil. Sjekk markerte tabs.");
      },
    )();
  }

  function handleCancel() {
    if (!product) return;
    form.reset(productToFormValues(product));
    setKeywords(originalKeywords);
    setSalesGroupIds(originalSalesGroupIds);
    setPackageItems(originalPackageItems);
    setLabelDepartmentIds(originalLabelDepartmentIds);
    setCakeLinks(originalCakeLinks);
    toast.info("Endringer forkastet");
  }

  /** Setter status til Aktiv — brukes på utkast fra «Ny vare»-veiviseren. */
  async function handleActivate() {
    if (!product) return;
    const { error } = await supabase.from("products").update({ status: "active" }).eq("id", product.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({
      action: "update",
      entity_type: "product",
      entity_id: product.id,
      entity_display_reference: product.display_name,
      changes: { status: { from: product.status, to: "active" } },
    });
    toast.success("Varen er aktiv");
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function handleDeactivate() {
    if (!product) return;
    setConfirmDeactivate(false);
    const { error } = await supabase.from("products").update({ status: "discontinued" }).eq("id", product.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({
      action: "discontinue",
      entity_type: "product",
      entity_id: product.id,
      entity_display_reference: product.display_name,
      changes: { status: { from: product.status, to: "discontinued" } },
    });
    toast.success("Vare de-aktivert");
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  // (Ctrl+S-handler ligger nå før early-return for å overholde Rules of Hooks)

  // Skjul Oppskrift for varianter
  const visibleTabs = TABS.filter((t) => !(t.type === "tab" && (t.id === "oppskrift" || t.id === "deklarasjon" || t.id === "kalkyle_pris") && product.variant_of_product_id));

  const lookups = lookupsQuery.data;
  const productOptions = lookups?.allProducts ?? [];

  return (
    <FormProvider {...form}>
      <DetailLayout
        product={{
          id: product.id,
          display_name: product.display_name,
          display_number: product.display_number,
          code: product.code,
          status: product.status as ProductStatus,
          variant_of_product_id: product.variant_of_product_id,
        }}
        tabs={visibleTabs}
        activeTab={tab}
        onTabChange={(id) => setParams({ tab: id })}
        dirtyTabs={dirtyTabs}
        errorTabs={errorTabs}
        isDirty={isDirty}
        saving={saving}
        canWrite={canWrite}
        onSave={handleSaveClick}
        onCancel={handleCancel}
        onDeactivate={() => setConfirmDeactivate(true)}
        onActivate={handleActivate}
      >
        {tab === "navn" && (
          <NavnOgNummerTab product={product} canWrite={canWrite} hasGs1Prefix={!!lookups?.hasGs1Prefix} />
        )}
        {tab === "kategorisering" && lookups && (
          <KategoriseringTab
            productId={product.id}
            canWrite={canWrite}
            mainCategories={lookups.mainCategories}
            subCategories={lookups.subCategories}
            productPages={lookups.productPages}
            salesGroups={lookups.salesGroups}
            selectedSalesGroupIds={salesGroupIds}
            onSalesGroupsChange={setSalesGroupIds}
            productOptions={productOptions}
          />
        )}
        {tab === "produksjon" && lookups && (
          <div className="space-y-4">
            <ProduksjonTab
              productId={product.id}
              canWrite={canWrite}
              legalEntityId={legalEntityId!}
              productionGroups={lookups.productionGroups}
              productionDepartments={lookups.productionDepartments}
              selectedDepartmentIds={labelDepartmentIds}
              onDepartmentsChange={setLabelDepartmentIds}
              cakeLinks={cakeLinks}
              originalCakeLinks={originalCakeLinks}
              onCakeLinksChange={setCakeLinks}
            />
            <SelvStekingCard
              productId={product.id}
              productName={product.display_name}
              canWrite={canWrite}
            />
          </div>
        )}
        {tab === "varedetaljer" && (
          <VaredetaljerTab canWrite={canWrite} keywords={keywords} onKeywordsChange={setKeywords} productId={product.id} />
        )}
        {tab === "leveranse" && <LeveranseTab canWrite={canWrite} />}
        {tab === "pakke" && (
          <PakkeTab
            productId={product.id}
            canWrite={canWrite}
            productOptions={productOptions}
            items={packageItems}
            onItemsChange={setPackageItems}
          />
        )}
        {tab === "retur" && <ReturTab productId={product.id} canWrite={canWrite} />}
        {tab === "lager" && (
          <StockTab
            productId={product.id}
            productName={product.display_name}
            canWrite={canWrite}
            legalEntityId={legalEntityId ?? undefined}
            productionDepartments={lookups?.productionDepartments ?? []}
          />
        )}
        {tab === "varianter" && (
          <VariantsTab
            product={product}
            variants={variantsQuery.data ?? []}
            onVariantCreated={() => qc.invalidateQueries({ queryKey: ["product-variants", id] })}
          />
        )}
        {tab === "oppskrift" && !product.variant_of_product_id && (
          <RecipeSummaryCard
            productId={product.id}
            productName={product.display_name}
            legalEntityId={legalEntityId}
            canWrite={canWrite}
          />
        )}
        {tab === "deklarasjon" && !product.variant_of_product_id && (
          <DeclarationTab productId={product.id} productName={product.display_name} canWrite={canWrite} />
        )}
        {tab === "kalkyle_pris" && !product.variant_of_product_id && (
          <CostPriceTab
            productId={product.id}
            productName={product.display_name}
            legalEntityId={legalEntityId}
            canWrite={canWrite}
          />
        )}
        {tab === "sortiment" && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Sortimentsstyring kommer når Kunder-appen er bygget.</CardContent></Card>
        )}
        {tab === "avvik" && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Avviksregistrering kommer i fremtidig iterasjon.</CardContent></Card>
        )}
      </DetailLayout>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>De-aktivere varen?</AlertDialogTitle>
            <AlertDialogDescription>
              «{product?.display_name}» settes til Utgått og kan ikke bestilles. Du kan aktivere den igjen senere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>De-aktiver</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesDialog
        open={unsavedGuard.isBlocked}
        onConfirm={unsavedGuard.discard}
        onCancel={unsavedGuard.stay}
      />
    </FormProvider>
  );
}

function VariantsTab({
  product,
  variants,
  onVariantCreated,
}: {
  product: any;
  variants: any[];
  onVariantCreated: () => void;
}) {
  const navigate = useNav();
  const { canWrite } = useAppContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (product.variant_of_product_id) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">
          Dette er en variant. Mor-vare:{" "}
          <button onClick={() => navigate(`/varer/vareliste/${product.variant_of_product_id}`)} className="text-app underline">
            Vis mor-vare
          </button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Varianter ({variants.length})</CardTitle>
        {canWrite && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>Ny variant</Button>
        )}
      </CardHeader>
      <CardContent>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ingen varianter ennå. Bruk «Ny variant» for å opprette en med arvet kalkyle, eller opprett ny vare og velg
            «Variant av».
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {variants.map((v) => (
              <li key={v.id}>
                <button onClick={() => navigate(`/varer/vareliste/${v.id}`)} className="flex w-full items-center justify-between py-3 text-left hover:text-app">
                  <span>
                    <span className="font-medium">{v.display_name}</span>
                    {v.variant_label && <span className="ml-2 text-xs text-muted-foreground">({v.variant_label})</span>}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">#{v.display_number}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <NewVariantDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        parent={product}
        onCreated={(newId) => {
          onVariantCreated();
          navigate(`/varer/vareliste/${newId}`);
        }}
      />
    </Card>
  );
}

/**
 * «Ny variant» oppretter et produkt med arvet kalkyle: calc_type = «arvet»,
 * variant_of_product_id og calc_source_product_id satt til mor-varen, og en
 * faktor på kost/pris — i tråd med arvelogikken i NewProductWizard.
 */
function NewVariantDialog({
  open,
  onOpenChange,
  parent,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parent: any;
  onCreated: (id: string) => void;
}) {
  const [variantLabel, setVariantLabel] = useState("");
  const [factor, setFactor] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  // Norsk tallformat: komma som desimalskille skal godtas («0,5»).
  const factorNum = parseNorwegianDecimal(factor);
  const factorInvalid = factor.trim().length > 0 && !(Number.isFinite(factorNum) && factorNum > 0);
  const valid = variantLabel.trim().length > 0 && Number.isFinite(factorNum) && factorNum > 0;

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const insertRow = {
        legal_entity_id: parent.legal_entity_id,
        code: `${parent.code}_${variantLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        display_name: `${parent.display_name} (${variantLabel.trim()})`,
        variant_label: variantLabel.trim(),
        unit_of_sale: parent.unit_of_sale,
        main_category_id: parent.main_category_id,
        product_category: parent.product_category,
        status: "draft",
        calc_type: "arvet",
        variant_of_product_id: parent.id,
        calc_source_product_id: parent.id,
        calc_factor: factorNum,
        mva_rate: parent.mva_rate,
        created_by: userData.user?.id ?? null,
      };
      const { data, error } = await supabase
        .from("products")
        .insert(insertRow as never)
        .select("id, display_name")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity_type: "product",
        entity_id: data.id,
        entity_display_reference: data.display_name,
        changes: { variant_of_product_id: parent.id, calc_type: "arvet", calc_factor: factorNum },
      });
      toast.success("Variant opprettet");
      onOpenChange(false);
      setVariantLabel("");
      setFactor("1");
      onCreated(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke opprette varianten");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ny variant</DialogTitle>
          <DialogDescription>
            Oppretter en vare med arvet kalkyle fra «{parent.display_name}», med en faktor på kost og pris.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Variant-etikett *</Label>
            <Input
              value={variantLabel}
              onChange={(e) => setVariantLabel(e.target.value)}
              placeholder="f.eks. Halv, Stor, Sukkerfri"
              autoFocus
            />
          </div>
          <div>
            <Label>Faktor *</Label>
            <Input
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              placeholder="1"
              inputMode="decimal"
              aria-invalid={factorInvalid}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Multipliseres med mor-varens kost og pris, f.eks. 0,5 for halv porsjon.
            </p>
            {factorInvalid && (
              <p className="mt-1 text-xs text-destructive">
                Skriv et tall større enn 0, for eksempel 0,5.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Opprett variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
