import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CalculationTab } from "@/varer/components/products/CalculationTab";
import { StockTab } from "@/varer/components/products/StockTab";
import { useNavigate as useNav } from "react-router-dom";

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
  { type: "tab", id: "kalkyle", label: "Kalkyle", icon: Receipt },
  { type: "tab", id: "priser", label: "Priser", icon: Receipt },
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
  const tab = params.get("tab") ?? "navn";
  const [saving, setSaving] = useState(false);
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

  const pricesQuery = useQuery({
    queryKey: ["product-prices", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("price_list_items")
        .select("id, price, valid_from, valid_to, price_lists(id, display_name, code)")
        .eq("product_id", id!)
        .order("valid_from", { ascending: false });
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

  async function handleDeactivate() {
    if (!product) return;
    if (!confirm(`De-aktivere "${product.display_name}"? Status settes til Utgått.`)) return;
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
  }

  // (Ctrl+S-handler ligger nå før early-return for å overholde Rules of Hooks)

  // Skjul Oppskrift for varianter
  const visibleTabs = TABS.filter((t) => !(t.type === "tab" && (t.id === "oppskrift" || t.id === "deklarasjon" || t.id === "kalkyle") && product.variant_of_product_id));

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
        onDeactivate={handleDeactivate}
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
        {tab === "varianter" && <VariantsTab product={product} variants={variantsQuery.data ?? []} />}
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
        {tab === "kalkyle" && !product.variant_of_product_id && (
          <CalculationTab productId={product.id} productName={product.display_name} canWrite={canWrite} />
        )}
        {tab === "priser" && (
          <Card>
            <CardHeader><CardTitle className="text-base">Priser</CardTitle></CardHeader>
            <CardContent>
              {(pricesQuery.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Denne varen ligger ikke i noen prisliste ennå. Gå til <a href="/varer/priser" className="text-app underline">Priser</a> for å legge den til.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2 text-left">Prisliste</th><th className="text-left">Gyldig fra</th><th className="text-left">Gyldig til</th><th className="text-right">Pris</th></tr>
                  </thead>
                  <tbody>
                    {pricesQuery.data!.map((p: any) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="py-2">{p.price_lists?.display_name}</td>
                        <td>{p.valid_from}</td>
                        <td>{p.valid_to ?? "—"}</td>
                        <td className="text-right tabular-nums">kr {Number(p.price).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}
        {tab === "sortiment" && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Sortimentsstyring kommer når Kunder-appen er bygget.</CardContent></Card>
        )}
        {tab === "avvik" && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Avviksregistrering kommer i fremtidig iterasjon.</CardContent></Card>
        )}
      </DetailLayout>

      <UnsavedChangesDialog
        open={unsavedGuard.isBlocked}
        onConfirm={unsavedGuard.discard}
        onCancel={unsavedGuard.stay}
      />
    </FormProvider>
  );
}

function VariantsTab({ product, variants }: { product: any; variants: any[] }) {
  const navigate = useNav();
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
      <CardHeader><CardTitle className="text-base">Varianter ({variants.length})</CardTitle></CardHeader>
      <CardContent>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen varianter ennå. Opprett ny vare og velg «Variant av».</p>
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
    </Card>
  );
}
