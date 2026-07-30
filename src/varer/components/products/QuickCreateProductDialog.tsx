import { useEffect, useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductSearchSelect, ProductOption } from "./detail/ProductSearchSelect";
import { UNITS_OF_SALE } from "@/varer/lib/constants";
import { logAudit } from "@/varer/lib/audit";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const codeRegex = /^[a-z0-9_]+$/;

const schema = z.object({
  display_name: z.string().trim().min(1, "Navn er påkrevd").max(120),
  code: z.string().trim().min(1, "Kode er påkrevd").max(60).regex(codeRegex, "Kun små bokstaver, tall og understrek"),
  unit_of_sale: z.enum(UNITS_OF_SALE),
  main_category_id: z.string().min(1, "Kategori er påkrevd"),
  variant_of_product_id: z.string().nullable(),
});
type Values = z.infer<typeof schema>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productOptions: ProductOption[];
}

export function QuickCreateProductDialog({ open, onOpenChange, productOptions }: Props) {
  const { legalEntityId } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const mainCategoriesQuery = useQuery({
    queryKey: ["main-categories", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_main_categories")
        .select("id, display_name")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active")
        .order("sort_order");
      return data ?? [];
    },
  });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: "",
      code: "",
      unit_of_sale: "stk",
      main_category_id: "",
      variant_of_product_id: null,
    },
  });

  // Auto-slug code fra display_name så lenge bruker ikke har tukla med code
  const name = form.watch("display_name");
  const [codeTouched, setCodeTouched] = useState(false);
  useEffect(() => {
    if (!codeTouched) form.setValue("code", slugify(name));
  }, [name, codeTouched, form]);

  async function submit(v: Values) {
    setSubmitting(true);
    const cat = mainCategoriesQuery.data?.find((c) => c.id === v.main_category_id);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("products")
      .insert({
        legal_entity_id: legalEntityId,
        code: v.code,
        display_name: v.display_name,
        unit_of_sale: v.unit_of_sale,
        main_category_id: v.main_category_id,
        product_category: cat?.display_name ?? "ukategorisert",
        variant_of_product_id: v.variant_of_product_id,
        status: "draft",
        created_by: userData.user?.id ?? null,
      } as never)
      .select("id, display_name, display_number, gtin")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "create",
      entity_type: "product",
      entity_id: data.id,
      entity_display_reference: data.display_name,
      changes: { display_number: data.display_number, code: v.code, gtin: data.gtin },
    });
    toast.success(`Vare opprettet (#${data.display_number})`, {
      description: "Fyll inn detaljer i de andre tabbene.",
    });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["price-lists-full"] });
    qc.invalidateQueries({ queryKey: ["return-products"] });
    qc.invalidateQueries({ queryKey: ["all-products-for-link"] });
    onOpenChange(false);
    form.reset();
    setCodeTouched(false);
    navigate(`/varer/vareliste/${data.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { form.reset(); setCodeTouched(false); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny vare</DialogTitle>
          <DialogDescription>Minimal opprettelse — fyll ut resten i tabbene etterpå.</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <div>
            <Label>Navn *</Label>
            <Input {...form.register("display_name")} placeholder="f.eks. Kneipp" autoFocus />
            {form.formState.errors.display_name && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.display_name.message}</p>
            )}
          </div>

          {form.formState.errors.code && (
            <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Salgsenhet *</Label>
              <Select value={form.watch("unit_of_sale")} onValueChange={(v) => form.setValue("unit_of_sale", v as Values["unit_of_sale"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS_OF_SALE.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Hovedgruppe *</Label>
              <Select
                value={form.watch("main_category_id") || undefined}
                onValueChange={(v) => form.setValue("main_category_id", v, { shouldValidate: true })}
              >
                <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                <SelectContent>
                  {(mainCategoriesQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                  ))}
                  {(mainCategoriesQuery.data?.length ?? 0) === 0 && (
                    <div className="px-3 py-4 text-sm text-muted-foreground">Ingen hovedgrupper</div>
                  )}
                </SelectContent>
              </Select>
              {form.formState.errors.main_category_id && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.main_category_id.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label>Variant av (valgfritt)</Label>
            <ProductSearchSelect
              value={form.watch("variant_of_product_id")}
              options={productOptions}
              onChange={(id) => form.setValue("variant_of_product_id", id)}
              placeholder="— Ingen (mor-vare) —"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button>
            <Button type="submit" disabled={submitting} className="bg-app hover:bg-app-dark text-app-foreground">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opprett
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
