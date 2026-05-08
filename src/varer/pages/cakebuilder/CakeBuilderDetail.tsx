import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CompatibilityRulesSection, type RuleProductOption } from "./CompatibilityRulesSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Cake,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { CAKE_LABEL_FIELD_OPTIONS, CAKE_ROLE_LABEL, CAKE_ROLE_OPTIONS, CAKE_SELECTION_TYPE_OPTIONS, CAKE_CATEGORY_STATUS_LABEL, CakeRole, CakeSelectionType } from "@/varer/lib/constants";
import { useAppContext } from "@/varer/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { logAudit } from "@/varer/lib/audit";
import { NewCategoryDialog } from "./NewCategoryDialog";
import { CakeBuilderPreview } from "./CakeBuilderPreview";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  draft: "bg-muted text-muted-foreground border-border",
  discontinued: "bg-destructive/10 text-destructive border-destructive/30",
};

interface CakeStep {
  id: string;
  step_order: number;
  name: string;
  description: string | null;
  selection_type: string;
  required: boolean;
  min_selections: number | null;
  max_selections: number | null;
  suggested_role: string | null;
  included_quantity: number;
  extra_unit_price: number;
  label_field_key: string | null;
}

interface StepProductRow {
  id: string;
  cake_step_id: string;
  product_id: string | null;
  default_selected: boolean;
  sort_order: number;
  display_number: number | null;
  display_name: string;
  display_name_override: string | null;
  cake_role: CakeRole | null;
  is_custom: boolean;
  custom_name: string | null;
  custom_extra_price: number;
}

export default function CakeBuilderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite, legalEntityId } = useAppContext();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<CakeStep | null>(null);
  const [deleteStepId, setDeleteStepId] = useState<string | null>(null);
  const [addProductStepId, setAddProductStepId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const cat = useQuery({
    queryKey: ["cake-category", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_categories")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const stepsQuery = useQuery({
    queryKey: ["cake-steps", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_steps")
        .select("*")
        .eq("cake_category_id", id!)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CakeStep[];
    },
  });

  const stepProductsQuery = useQuery({
    queryKey: ["cake-step-products", id],
    enabled: !!id && (stepsQuery.data?.length ?? 0) > 0,
    queryFn: async () => {
      const stepIds = (stepsQuery.data ?? []).map((s) => s.id);
      if (stepIds.length === 0) return [];
      const { data, error } = await supabase
        .from("cake_step_products")
        .select(
          "id, cake_step_id, product_id, default_selected, sort_order, display_name_override, custom_name, custom_extra_price, products(display_number, display_name, cake_role)",
        )
        .in("cake_step_id", stepIds)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        const isCustom = !r.product_id;
        return {
          id: r.id,
          cake_step_id: r.cake_step_id,
          product_id: r.product_id,
          default_selected: r.default_selected,
          sort_order: r.sort_order,
          display_number: r.products?.display_number ?? null,
          display_name: r.products?.display_name ?? r.custom_name ?? "",
          display_name_override: r.display_name_override ?? null,
          cake_role: r.products?.cake_role ?? null,
          is_custom: isCustom,
          custom_name: r.custom_name ?? null,
          custom_extra_price: Number(r.custom_extra_price ?? 0),
        };
      }) as StepProductRow[];
    },
  });

  const productsByStep = useMemo(() => {
    const m = new Map<string, StepProductRow[]>();
    (stepProductsQuery.data ?? []).forEach((p) => {
      const arr = m.get(p.cake_step_id) ?? [];
      arr.push(p);
      m.set(p.cake_step_id, arr);
    });
    return m;
  }, [stepProductsQuery.data]);

  const ruleOptions = useMemo<RuleProductOption[]>(() => {
    const steps = stepsQuery.data ?? [];
    const stepNameById = new Map(steps.map((s) => [s.id, s.name]));
    const out: RuleProductOption[] = [];
    (stepProductsQuery.data ?? []).forEach((p) => {
      const stepName = stepNameById.get(p.cake_step_id) ?? "";
      const label =
        p.display_name_override?.trim() ||
        (p.product_id
          ? `${p.display_number ?? ""} ${p.display_name}`.trim()
          : p.custom_name ?? p.display_name);
      // Use product UUID for real products, custom:<row-id> for name-only blocks
      const id = p.product_id ?? `custom:${p.id}`;
      out.push({ id, label, step_name: stepName });
    });
    return out;
  }, [stepsQuery.data, stepProductsQuery.data]);

  const totalProducts = stepProductsQuery.data?.length ?? 0;
  const stepCount = stepsQuery.data?.length ?? 0;

  // ======== Mutasjoner ========

  const reorderSteps = useMutation({
    mutationFn: async (newOrder: CakeStep[]) => {
      // To-fase for å unngå unique-constraint kollisjoner: bruk negative midlertidige verdier
      const tempUpdates = newOrder.map((s, i) =>
        supabase.from("cake_steps").update({ step_order: -(i + 1) }).eq("id", s.id),
      );
      await Promise.all(tempUpdates);
      const finalUpdates = newOrder.map((s, i) =>
        supabase.from("cake_steps").update({ step_order: i + 1 }).eq("id", s.id),
      );
      await Promise.all(finalUpdates);
      await logAudit({
        action: "cake_step_reordered",
        entity_type: "cake_step",
        entity_id: id,
        entity_display_reference: cat.data?.name ?? null,
        changes: { order: newOrder.map((s) => s.id) },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-steps", id] }),
    onError: (e: any) =>
      toast({ title: "Kunne ikke endre rekkefølge", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      const { error } = await supabase
        .from("cake_categories")
        .update({ status: newStatus })
        .eq("id", id!);
      if (error) throw error;
      await logAudit({
        action: "cake_category_updated",
        entity_type: "cake_category",
        entity_id: id,
        entity_display_reference: cat.data?.name ?? null,
        changes: { status: newStatus },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-category", id] });
      qc.invalidateQueries({ queryKey: ["cake-categories"] });
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cake_categories").delete().eq("id", id!);
      if (error) throw error;
      await logAudit({
        action: "cake_category_deleted",
        entity_type: "cake_category",
        entity_id: id,
        entity_display_reference: cat.data?.name ?? null,
      });
    },
    onSuccess: () => {
      toast({ title: "Kategori slettet" });
      qc.invalidateQueries({ queryKey: ["cake-categories"] });
      navigate("/varer/kakebygger");
    },
    onError: (e: any) =>
      toast({ title: "Kunne ikke slette", description: e.message, variant: "destructive" }),
  });

  const deleteStep = useMutation({
    mutationFn: async (stepId: string) => {
      const step = stepsQuery.data?.find((s) => s.id === stepId);
      const { error } = await supabase.from("cake_steps").delete().eq("id", stepId);
      if (error) throw error;
      await logAudit({
        action: "cake_step_deleted",
        entity_type: "cake_step",
        entity_id: stepId,
        entity_display_reference: step?.name ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-steps", id] });
      qc.invalidateQueries({ queryKey: ["cake-step-products", id] });
      qc.invalidateQueries({ queryKey: ["cake-categories"] });
      setDeleteStepId(null);
    },
    onError: (e: any) =>
      toast({ title: "Kunne ikke slette steg", description: e.message, variant: "destructive" }),
  });

  const toggleDefault = useMutation({
    mutationFn: async (row: StepProductRow) => {
      const next = !row.default_selected;
      const { error } = await supabase
        .from("cake_step_products")
        .update({ default_selected: next })
        .eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_default_toggled",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: row.display_name,
        changes: { default_selected: next },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-step-products", id] }),
  });

  const removeProduct = useMutation({
    mutationFn: async (row: StepProductRow) => {
      const { error } = await supabase.from("cake_step_products").delete().eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_removed",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: row.display_name,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-step-products", id] });
      qc.invalidateQueries({ queryKey: ["cake-categories"] });
    },
  });

  const saveDisplayNameOverride = useMutation({
    mutationFn: async ({ row, value }: { row: StepProductRow; value: string }) => {
      const trimmed = value.trim();
      const next = trimmed.length > 0 ? trimmed : null;
      if ((row.display_name_override ?? null) === next) return;
      const { error } = await supabase
        .from("cake_step_products")
        .update({ display_name_override: next })
        .eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_display_name_updated",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: row.display_name,
        changes: { display_name_override: next },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-step-products", id] }),
    onError: (e: any) =>
      toast({ title: "Kunne ikke lagre visningsnavn", description: e.message, variant: "destructive" }),
  });

  const saveCustomName = useMutation({
    mutationFn: async ({ row, value }: { row: StepProductRow; value: string }) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error("Navn kan ikke være tomt");
      }
      if ((row.custom_name ?? "") === trimmed) return;
      const { error } = await supabase
        .from("cake_step_products")
        .update({ custom_name: trimmed })
        .eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_custom_name_updated",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: trimmed,
        changes: { custom_name: trimmed },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-step-products", id] }),
    onError: (e: any) =>
      toast({ title: "Kunne ikke lagre navn", description: e.message, variant: "destructive" }),
  });

  const saveCustomExtraPrice = useMutation({
    mutationFn: async ({ row, value }: { row: StepProductRow; value: number }) => {
      const next = Number.isFinite(value) && value >= 0 ? value : 0;
      if (Number(row.custom_extra_price ?? 0) === next) return;
      const { error } = await supabase
        .from("cake_step_products")
        .update({ custom_extra_price: next })
        .eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_extra_price_updated",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: row.display_name,
        changes: { custom_extra_price: next },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-step-products", id] }),
    onError: (e: any) =>
      toast({ title: "Kunne ikke lagre pris-tillegg", description: e.message, variant: "destructive" }),
  });

  const [linkRow, setLinkRow] = useState<StepProductRow | null>(null);

  const linkToProduct = useMutation({
    mutationFn: async ({ row, productId }: { row: StepProductRow; productId: string }) => {
      const { error } = await supabase
        .from("cake_step_products")
        .update({ product_id: productId, custom_name: null })
        .eq("id", row.id);
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_linked_to_product",
        entity_type: "cake_step_product",
        entity_id: row.id,
        entity_display_reference: row.display_name,
        changes: { product_id: productId },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cake-step-products", id] });
      setLinkRow(null);
      toast({ title: "Koblet til vare" });
    },
    onError: (e: any) =>
      toast({ title: "Kunne ikke koble", description: e.message, variant: "destructive" }),
  });

  // ======== DnD ========

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const steps = stepsQuery.data ?? [];
    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(steps, oldIndex, newIndex);
    qc.setQueryData(["cake-steps", id], next.map((s, i) => ({ ...s, step_order: i + 1 })));
    reorderSteps.mutate(next);
  }

  function toggleExpand(stepId: string) {
    setExpandedSteps((prev) => {
      const n = new Set(prev);
      if (n.has(stepId)) n.delete(stepId);
      else n.add(stepId);
      return n;
    });
  }

  if (cat.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!cat.data) {
    return <div className="p-6 text-muted-foreground">Kategori ikke funnet.</div>;
  }

  const c = cat.data;

  return (
    <>
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/varer/kakebygger")}
            className="mb-3 -ml-2"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake til Kakebygger
          </Button>
          <div className="flex items-start gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
              {c.image_url ? (
                <img src={c.image_url} alt={c.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Cake className="h-8 w-8 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{c.name}</h1>
                <Badge variant="outline" className={STATUS_BADGE[c.status] ?? ""}>
                  {CAKE_CATEGORY_STATUS_LABEL[c.status] ?? c.status}
                </Badge>
              </div>
              {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <Eye className="mr-1.5 h-4 w-4" /> Forhåndsvis
              </Button>
              {canWrite && (
                <>
                  <Select value={c.status} onValueChange={(v) => updateStatus.mutate(v)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Utkast</SelectItem>
                      <SelectItem value="active">Aktiv</SelectItem>
                      <SelectItem value="discontinued">Utgått</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-1.5 h-4 w-4" /> Rediger
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Slett
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
            <div className="font-medium">Steg</div>
            {canWrite && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingStep(null);
                  setStepDialogOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Legg til steg
              </Button>
            )}
          </div>

          {stepsQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (stepsQuery.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Ingen steg ennå. Klikk «Legg til steg».
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={(stepsQuery.data ?? []).map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div>
                  {(stepsQuery.data ?? []).map((step) => (
                    <SortableStepRow
                      key={step.id}
                      step={step}
                      products={productsByStep.get(step.id) ?? []}
                      expanded={expandedSteps.has(step.id)}
                      onToggleExpand={() => toggleExpand(step.id)}
                      canWrite={canWrite}
                      onEdit={() => {
                        setEditingStep(step);
                        setStepDialogOpen(true);
                      }}
                      onDelete={() => setDeleteStepId(step.id)}
                      onAddProduct={() => setAddProductStepId(step.id)}
                      onToggleDefault={(p) => toggleDefault.mutate(p)}
                      onRemoveProduct={(p) => removeProduct.mutate(p)}
                      onSaveDisplayNameOverride={(p, v) =>
                        saveDisplayNameOverride.mutate({ row: p, value: v })
                      }
                      onSaveCustomName={(p, v) =>
                        saveCustomName.mutate({ row: p, value: v })
                      }
                      onSaveCustomExtraPrice={(p, v) =>
                        saveCustomExtraPrice.mutate({ row: p, value: v })
                      }
                      onLinkToProduct={(p) => setLinkRow(p)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </Card>
      </div>

      <CompatibilityRulesSection
        cakeCategoryId={c.id}
        canWrite={canWrite}
        options={ruleOptions}
      />

      <NewCategoryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        category={editOpen ? { id: c.id, name: c.name, description: c.description, image_url: c.image_url } : null}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett kake-kategori «{c.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {stepCount === 0 && totalProducts === 0
                ? "Kategorien har ingen steg eller byggeklosser. Sletting kan ikke angres."
                : `Sletter også ${stepCount} steg og ${totalProducts} produkt-koblinger. Kan ikke angres.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCategory.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StepDialog
        open={stepDialogOpen}
        onOpenChange={setStepDialogOpen}
        cakeCategoryId={id!}
        existingStepCount={stepCount}
        step={editingStep}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["cake-steps", id] });
          qc.invalidateQueries({ queryKey: ["cake-categories"] });
        }}
      />

      <AlertDialog open={!!deleteStepId} onOpenChange={(o) => !o && setDeleteStepId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett steg?</AlertDialogTitle>
            <AlertDialogDescription>
              Sletter også alle byggeklosser i steget. Kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteStepId && deleteStep.mutate(deleteStepId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddProductDialog
        open={!!addProductStepId}
        onOpenChange={(o) => !o && setAddProductStepId(null)}
        step={stepsQuery.data?.find((s) => s.id === addProductStepId) ?? null}
        existingProductIds={
          addProductStepId
            ? (productsByStep.get(addProductStepId) ?? [])
                .map((p) => p.product_id)
                .filter((id): id is string => !!id)
            : []
        }
        existingCount={addProductStepId ? (productsByStep.get(addProductStepId) ?? []).length : 0}
        onAdded={() => {
          qc.invalidateQueries({ queryKey: ["cake-step-products", id] });
          qc.invalidateQueries({ queryKey: ["cake-categories"] });
        }}
      />

      <LinkToProductDialog
        row={linkRow}
        onOpenChange={(o) => !o && setLinkRow(null)}
        onLink={(productId) => {
          if (linkRow) linkToProduct.mutate({ row: linkRow, productId });
        }}
      />

      <CakeBuilderPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        initialCategoryId={id}
      />
    </>
  );
}

// ======== Sortable step row ========

function SortableStepRow({
  step,
  products,
  expanded,
  onToggleExpand,
  canWrite,
  onEdit,
  onDelete,
  onAddProduct,
  onToggleDefault,
  onRemoveProduct,
  onSaveDisplayNameOverride,
  onSaveCustomName,
  onSaveCustomExtraPrice,
  onLinkToProduct,
}: {
  step: CakeStep;
  products: StepProductRow[];
  expanded: boolean;
  onToggleExpand: () => void;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddProduct: () => void;
  onToggleDefault: (p: StepProductRow) => void;
  onRemoveProduct: (p: StepProductRow) => void;
  onSaveDisplayNameOverride: (p: StepProductRow, value: string) => void;
  onSaveCustomName: (p: StepProductRow, value: string) => void;
  onSaveCustomExtraPrice: (p: StepProductRow, value: number) => void;
  onLinkToProduct: (p: StepProductRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const selectionTypeLabel =
    CAKE_SELECTION_TYPE_OPTIONS.find((o) => o.value === step.selection_type)?.label ?? step.selection_type;

  return (
    <div ref={setNodeRef} style={style} className="border-b border-border last:border-b-0">
      <Collapsible open={expanded} onOpenChange={onToggleExpand}>
        <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/30">
          {canWrite && (
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              aria-label="Dra for å endre rekkefølge"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-3 text-left">
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="w-6 text-xs tabular-nums text-muted-foreground">{step.step_order}</span>
              <span className="font-medium">{step.name}</span>
              <Badge variant="outline" className="text-xs">{selectionTypeLabel}</Badge>
              {step.required && <Badge variant="outline" className="text-xs">Påkrevd</Badge>}
              {step.suggested_role && (
                <Badge variant="outline" className="border-app/30 bg-app/10 text-app text-xs">
                  Forslag: {CAKE_ROLE_LABEL[step.suggested_role as CakeRole]}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {products.length} byggeklosser
              </span>
            </button>
          </CollapsibleTrigger>
          {canWrite && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={onEdit} title="Rediger">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete} title="Slett">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <CollapsibleContent>
          <div className="border-t border-border bg-muted/20 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Byggeklosser</span>
                {step.selection_type === "multi" && step.included_quantity > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {step.included_quantity} inkl. · +{step.extra_unit_price} kr per ekstra
                  </Badge>
                )}
              </div>
              {canWrite && (
                <Button size="sm" variant="outline" onClick={onAddProduct}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Legg til produkt
                </Button>
              )}
            </div>
            {products.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Ingen byggeklosser i dette steget.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Nr</TableHead>
                    <TableHead>Navn</TableHead>
                    <TableHead className="w-56">Visningsnavn (kakebygger)</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead className="w-28">Pris-tillegg</TableHead>
                    <TableHead className="w-32">Forhåndsvalgt</TableHead>
                    {canWrite && <TableHead className="w-28"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {p.is_custom ? (
                          <Badge variant="outline" className="text-[10px]">
                            Navn
                          </Badge>
                        ) : (
                          p.display_number
                        )}
                      </TableCell>
                      <TableCell>
                        {p.is_custom ? (
                          <CustomNameInput
                            row={p}
                            disabled={!canWrite}
                            onSave={(value) => onSaveCustomName(p, value)}
                          />
                        ) : (
                          p.display_name
                        )}
                      </TableCell>
                      <TableCell>
                        {p.is_custom ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <DisplayNameOverrideInput
                            row={p}
                            disabled={!canWrite}
                            onSave={(value) => onSaveDisplayNameOverride(p, value)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {p.cake_role ? (
                          <Badge variant="outline">{CAKE_ROLE_LABEL[p.cake_role]}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <CustomExtraPriceInput
                          row={p}
                          disabled={!canWrite}
                          onSave={(value) => onSaveCustomExtraPrice(p, value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={p.default_selected}
                          onCheckedChange={() => onToggleDefault(p)}
                          disabled={!canWrite}
                        />
                      </TableCell>
                      {canWrite && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {p.is_custom && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Koble til vare"
                                onClick={() => onLinkToProduct(p)}
                              >
                                <LinkIcon className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => onRemoveProduct(p)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ======== Step dialog (create/edit) ========

function StepDialog({
  open,
  onOpenChange,
  cakeCategoryId,
  existingStepCount,
  step,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cakeCategoryId: string;
  existingStepCount: number;
  step: CakeStep | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectionType, setSelectionType] = useState<CakeSelectionType>("single");
  const [required, setRequired] = useState(true);
  const [minSel, setMinSel] = useState<string>("");
  const [maxSel, setMaxSel] = useState<string>("");
  const [includedQuantity, setIncludedQuantity] = useState<string>("0");
  const [extraUnitPrice, setExtraUnitPrice] = useState<string>("0");
  const [suggestedRole, setSuggestedRole] = useState<string>("__none__");
  const [labelFieldKey, setLabelFieldKey] = useState<string>("__none__");

  useEffect(() => {
    if (open) {
      setName(step?.name ?? "");
      setDescription(step?.description ?? "");
      setSelectionType((step?.selection_type as CakeSelectionType) ?? "single");
      setRequired(step?.required ?? true);
      setMinSel(step?.min_selections != null ? String(step.min_selections) : "");
      setMaxSel(step?.max_selections != null ? String(step.max_selections) : "");
      setIncludedQuantity(String(step?.included_quantity ?? 0));
      setExtraUnitPrice(String(step?.extra_unit_price ?? 0));
      setSuggestedRole(step?.suggested_role ?? "__none__");
      setLabelFieldKey(step?.label_field_key ?? "__none__");
    }
  }, [open, step]);

  const isMulti = selectionType === "multi";

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Navn er påkrevd", variant: "destructive" });
      return;
    }
    const parsedIncluded = Math.max(0, Math.floor(Number(includedQuantity) || 0));
    const parsedExtraPrice = Math.max(0, Number(extraUnitPrice.replace(",", ".")) || 0);
    const payload = {
      name: trimmed,
      description: description.trim() || null,
      selection_type: selectionType,
      required,
      min_selections: isMulti && minSel ? Number(minSel) : null,
      max_selections: isMulti && maxSel ? Number(maxSel) : null,
      included_quantity: isMulti ? parsedIncluded : 0,
      extra_unit_price: isMulti ? parsedExtraPrice : 0,
      suggested_role: suggestedRole === "__none__" ? null : suggestedRole,
      label_field_key:
        (selectionType === "text" || selectionType === "number") && labelFieldKey !== "__none__"
          ? labelFieldKey
          : null,
    };
    try {
      if (step) {
        const { error } = await supabase.from("cake_steps").update(payload).eq("id", step.id);
        if (error) throw error;
        await logAudit({
          action: "cake_step_updated",
          entity_type: "cake_step",
          entity_id: step.id,
          entity_display_reference: trimmed,
          changes: payload,
        });
      } else {
        const { data, error } = await supabase
          .from("cake_steps")
          .insert({
            cake_category_id: cakeCategoryId,
            step_order: existingStepCount + 1,
            ...payload,
          })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "cake_step_created",
          entity_type: "cake_step",
          entity_id: data.id,
          entity_display_reference: trimmed,
        });
      }
      toast({ title: step ? "Steg oppdatert" : "Steg opprettet" });
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Kunne ikke lagre steg", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{step ? "Rediger steg" : "Nytt steg"}</DialogTitle>
          <DialogDescription>
            Et steg er én skjerm i wizarden hvor kunden velger byggeklosser (f.eks. «Pynt» eller «Fyll»).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="step-name">Navn *</Label>
            <Input id="step-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pynt" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type valg</Label>
              <Select value={selectionType} onValueChange={(v) => setSelectionType(v as CakeSelectionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAKE_SELECTION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Foreslått rolle</Label>
              <Select value={suggestedRole} onValueChange={setSuggestedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ingen forslag</SelectItem>
                  {CAKE_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="step-required" checked={required} onCheckedChange={setRequired} />
            <Label htmlFor="step-required">Påkrevd</Label>
          </div>
          {isMulti && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="min-sel">Min valg</Label>
                  <Input
                    id="min-sel"
                    type="number"
                    min="0"
                    value={minSel}
                    onChange={(e) => setMinSel(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-sel">Maks valg</Label>
                  <Input
                    id="max-sel"
                    type="number"
                    min="0"
                    value={maxSel}
                    onChange={(e) => setMaxSel(e.target.value)}
                  />
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Pris-tillegg ved ekstra valg
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="included-qty">Antall inkludert i prisen</Label>
                    <Input
                      id="included-qty"
                      type="number"
                      min="0"
                      value={includedQuantity}
                      onChange={(e) => setIncludedQuantity(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      F.eks. 2 = de første 2 valgene er inkludert i kakens grunnpris.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="extra-price">Pris per ekstra valg</Label>
                    <div className="relative">
                      <Input
                        id="extra-price"
                        inputMode="decimal"
                        value={extraUnitPrice}
                        onChange={(e) => setExtraUnitPrice(e.target.value)}
                        className="pr-8 tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        kr
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Legges til for hvert valg utover «inkludert».
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
          {(selectionType === "text" || selectionType === "number") && (
            <div className="space-y-1.5 rounded-md border border-app/30 bg-app/5 p-3">
              <Label htmlFor="step-label-key">Etikett-felt</Label>
              <Select value={labelFieldKey} onValueChange={setLabelFieldKey}>
                <SelectTrigger id="step-label-key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ikke etikett-felt</SelectItem>
                  {CAKE_LABEL_FIELD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Hvis satt, mappes svaret til dette feltet på etikett-utskriften i Produksjon-appen.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="step-desc">Beskrivelse</Label>
            <Textarea
              id="step-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={handleSave}>{step ? "Lagre" : "Opprett"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// ======== Add product dialog ========

function AddProductDialog({
  open,
  onOpenChange,
  step,
  existingProductIds,
  existingCount,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  step: CakeStep | null;
  existingProductIds: string[];
  existingCount: number;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const { legalEntityId } = useAppContext();
  const [search, setSearch] = useState("");

  const candidates = useQuery({
    queryKey: ["cake-candidate-products", legalEntityId, existingProductIds.join(",")],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select("id, display_number, display_name, cake_role, code")
        .eq("legal_entity_id", legalEntityId)
        .eq("is_cake_component", true)
        .order("display_number", { ascending: true })
        .limit(500);
      if (existingProductIds.length > 0) {
        q = q.not("id", "in", `(${existingProductIds.join(",")})`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (candidates.data ?? []).filter((p: any) => {
      if (!q) return true;
      return (
        p.display_name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        String(p.display_number).includes(q)
      );
    });
    if (step?.suggested_role) {
      const role = step.suggested_role;
      list = [...list].sort((a: any, b: any) => {
        const am = a.cake_role === role ? 0 : 1;
        const bm = b.cake_role === role ? 0 : 1;
        if (am !== bm) return am - bm;
        return a.display_number - b.display_number;
      });
    }
    return list;
  }, [candidates.data, search, step?.suggested_role]);

  async function handleAdd(productId: string, productName: string) {
    if (!step) return;
    try {
      const { data, error } = await supabase
        .from("cake_step_products")
        .insert({
          cake_step_id: step.id,
          product_id: productId,
          sort_order: existingCount + 1,
          default_selected: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_added",
        entity_type: "cake_step_product",
        entity_id: data.id,
        entity_display_reference: `${step.name} → ${productName}`,
      });
      toast({ title: "Byggekloss lagt til" });
      onAdded();
    } catch (e: any) {
      toast({ title: "Kunne ikke legge til", description: e.message, variant: "destructive" });
    }
  }

  const [customName, setCustomName] = useState("");
  const [customExtraPrice, setCustomExtraPrice] = useState("0");
  const [savingCustom, setSavingCustom] = useState(false);

  async function handleAddCustom() {
    if (!step) return;
    const trimmed = customName.trim();
    if (trimmed.length === 0) {
      toast({ title: "Navn er påkrevd", variant: "destructive" });
      return;
    }
    const parsedPrice = Number(customExtraPrice.replace(",", "."));
    const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
    setSavingCustom(true);
    try {
      const { data, error } = await supabase
        .from("cake_step_products")
        .insert({
          cake_step_id: step.id,
          product_id: null,
          custom_name: trimmed,
          custom_extra_price: price,
          sort_order: existingCount + 1,
          default_selected: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "cake_step_product_added",
        entity_type: "cake_step_product",
        entity_id: data.id,
        entity_display_reference: `${step.name} → ${trimmed} (kun navn)`,
      });
      toast({ title: "Navn-byggekloss lagt til" });
      setCustomName("");
      setCustomExtraPrice("0");
      onAdded();
    } catch (e: any) {
      toast({ title: "Kunne ikke legge til", description: e.message, variant: "destructive" });
    } finally {
      setSavingCustom(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Legg til byggekloss{step ? ` i «${step.name}»` : ""}</DialogTitle>
          <DialogDescription>
            Viser kun produkter merket som «Kakebygger-byggekloss» (Produksjon-fanen på varekortet).
            {step?.suggested_role && (
              <> Produkter med rollen <strong>{CAKE_ROLE_LABEL[step.suggested_role as CakeRole]}</strong> vises øverst.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Eller legg til en byggekloss kun med navn (uten varenummer)
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <Input
              placeholder="Navn (f.eks. «Ingen pynt»)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <div className="relative">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={customExtraPrice}
                onChange={(e) => setCustomExtraPrice(e.target.value)}
                className="pr-8 tabular-nums"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                kr
              </span>
            </div>
            <Button onClick={handleAddCustom} disabled={savingCustom || !customName.trim()}>
              {savingCustom ? <Loader2 className="h-4 w-4 animate-spin" /> : "Legg til"}
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Søk i navn, kode eller nummer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
          {candidates.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAndSorted.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Ingen tilgjengelige byggeklosser. Aktiver «Kakebygger-byggekloss» på varekortet først.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Nr</TableHead>
                  <TableHead>Navn</TableHead>
                  <TableHead>Rolle</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSorted.map((p: any) => {
                  const isMatch = step?.suggested_role && p.cake_role === step.suggested_role;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{p.display_number}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {p.display_name}
                          {isMatch && (
                            <Badge variant="outline" className="border-success/30 bg-success/10 text-success text-xs">
                              Anbefalt
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.cake_role ? (
                          <Badge variant="outline">{CAKE_ROLE_LABEL[p.cake_role as CakeRole]}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => handleAdd(p.id, p.display_name)}>
                          Legg til
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ======== Inline editor for display_name_override ========

function DisplayNameOverrideInput({
  row,
  disabled,
  onSave,
}: {
  row: StepProductRow;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(row.display_name_override ?? "");

  // Hold lokal state synkron når raden endrer seg eksternt (f.eks. etter invalidate)
  useEffect(() => {
    setValue(row.display_name_override ?? "");
  }, [row.id, row.display_name_override]);

  const commit = () => {
    if ((row.display_name_override ?? "") !== value) onSave(value);
  };

  return (
    <Input
      value={value}
      placeholder={row.display_name}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setValue(row.display_name_override ?? "");
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={disabled}
      className="h-8 text-sm"
    />
  );
}

// ======== Inline editor for custom_name (kun for navn-baserte byggeklosser) ========

function CustomNameInput({
  row,
  disabled,
  onSave,
}: {
  row: StepProductRow;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(row.custom_name ?? "");

  useEffect(() => {
    setValue(row.custom_name ?? "");
  }, [row.id, row.custom_name]);

  const commit = () => {
    if ((row.custom_name ?? "") !== value && value.trim().length > 0) onSave(value);
    else if (value.trim().length === 0) setValue(row.custom_name ?? "");
  };

  return (
    <Input
      value={value}
      placeholder="Navn på byggekloss"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setValue(row.custom_name ?? "");
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={disabled}
      className="h-8 text-sm"
    />
  );
}

// ======== Inline editor for custom_extra_price ========

function CustomExtraPriceInput({
  row,
  disabled,
  onSave,
}: {
  row: StepProductRow;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(String(row.custom_extra_price ?? 0));

  useEffect(() => {
    setValue(String(row.custom_extra_price ?? 0));
  }, [row.id, row.custom_extra_price]);

  const commit = () => {
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setValue(String(row.custom_extra_price ?? 0));
      return;
    }
    if (parsed !== Number(row.custom_extra_price ?? 0)) onSave(parsed);
  };

  return (
    <div className="relative">
      <Input
        value={value}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setValue(String(row.custom_extra_price ?? 0));
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        className="h-8 pr-8 text-sm tabular-nums"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        kr
      </span>
    </div>
  );
}

// ======== Dialog: koble navn-byggekloss til varenummer ========

function LinkToProductDialog({
  row,
  onOpenChange,
  onLink,
}: {
  row: StepProductRow | null;
  onOpenChange: (open: boolean) => void;
  onLink: (productId: string) => void;
}) {
  const { legalEntityId } = useAppContext();
  const [search, setSearch] = useState("");

  const candidates = useQuery({
    queryKey: ["cake-link-candidates", legalEntityId],
    enabled: !!row,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_number, display_name, cake_role, code")
        .eq("legal_entity_id", legalEntityId)
        .eq("is_cake_component", true)
        .order("display_number", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (candidates.data ?? []).filter((p: any) => {
      if (!q) return true;
      return (
        p.display_name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        String(p.display_number).includes(q)
      );
    });
  }, [candidates.data, search]);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Koble «{row?.custom_name ?? ""}» til varenummer</DialogTitle>
          <DialogDescription>
            Velg et eksisterende produkt. Pris-tillegget på byggeklossen beholdes,
            men navn og varenummer overtas fra produktet.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Søk i navn, kode eller nummer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
          {candidates.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Ingen produkter funnet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Nr</TableHead>
                  <TableHead>Navn</TableHead>
                  <TableHead>Rolle</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{p.display_number}</TableCell>
                    <TableCell>{p.display_name}</TableCell>
                    <TableCell>
                      {p.cake_role ? (
                        <Badge variant="outline">{CAKE_ROLE_LABEL[p.cake_role as CakeRole]}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => onLink(p.id)}>
                        Koble
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Lukk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
