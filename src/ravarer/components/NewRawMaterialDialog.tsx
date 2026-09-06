import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCreateRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { BASE_UNITS, PACKAGE_UNITS } from "@/ravarer/lib/constants";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { Checkbox } from "@/components/ui/checkbox";
import { categoryGroups } from "@/ravarer/lib/categories";
import { ITEM_TYPES, defaultCategoryFor, type ItemType } from "@/ravarer/lib/itemTypes";
import { useNavigate } from "react-router-dom";

const schema = z.object({
  sku: z.string().trim().min(1, "Påkrevd"),
  name: z.string().trim().min(1, "Påkrevd"),
  category: z.string().optional(),
  categories: z.array(z.string()).default([]),
  item_type: z.enum(["ravare", "emballasje", "forbruksvare", "videresalg"]).default("ravare"),
  base_unit: z.string().min(1, "Velg enhet"),
  package_size: z.coerce.number().positive().optional().or(z.literal("").transform(() => undefined)),
  package_unit: z.string().optional(),
  current_cost_price: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)),
  agreed_price: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)),
  is_packaging: z.boolean().default(false),
  description: z.string().optional(),
});

type Values = z.input<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
  /** Forhåndsutfylt navn, f.eks. fra Matvaretabellen. */
  initialName?: string;
}

export function NewRawMaterialDialog({ open, onOpenChange, onCreated, initialName }: Props) {
  const navigate = useNavigate();
  const create = useCreateRawMaterial();

  const form = useForm<Values>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      sku: "",
      name: initialName ?? "",
      category: "",
      categories: [],
      item_type: "ravare",
      base_unit: "kg",
      package_unit: "",
      is_packaging: false,
      description: "",
    },
  });

  useEffect(() => {
    if (open && initialName) form.setValue("name", initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);


  const onSubmit = form.handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    const created = await create.mutateAsync({
      sku: v.sku,
      name: v.name,
      category: v.category || null,
      categories: v.categories,
      item_type: v.item_type,
      base_unit: v.base_unit,
      package_size: v.package_size ?? null,
      package_unit: v.package_unit || null,
      current_cost_price: v.current_cost_price ?? null,
      agreed_price: v.agreed_price ?? null,
      is_packaging: v.is_packaging,
      description: v.description || null,
    });
    onOpenChange(false);
    form.reset();
    if (onCreated) onCreated(created.id);
    else navigate(`/ravarer/vareliste/${created.id}`);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ny råvare</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField name="sku" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU *</FormLabel>
                  <FormControl><Input {...field} placeholder="f.eks. MEL-001" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="category" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Kategori</FormLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <CategorySelectItems existing={[field.value]} />
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <FormField name="item_type" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Varetype *</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    const suggested = defaultCategoryFor(v as ItemType);
                    if (suggested && !form.getValues("category")) form.setValue("category", suggested);
                  }}
                >
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {ITEM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField name="categories" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Flere kategorier</FormLabel>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {categoryGroups().map((g) => (
                    <div key={g.label} className="space-y-1">
                      <p className="text-xs font-medium text-ink-secondary">{g.label}</p>
                      {g.items.map((c) => {
                        const selected = (field.value ?? []).includes(c);
                        return (
                          <label key={c} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(v) =>
                                field.onChange(
                                  v === true
                                    ? [...(field.value ?? []), c]
                                    : (field.value ?? []).filter((x: string) => x !== c),
                                )
                              }
                            />
                            {c}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </FormItem>
            )} />
            <FormField name="name" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Navn *</FormLabel>
                <FormControl><Input {...field} placeholder="f.eks. Hvetemel Sigdal" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-3 gap-3">
              <FormField name="base_unit" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Basisenhet *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {BASE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="package_size" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Pakn. størrelse</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="package_unit" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Pakn. enhet</FormLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Velg" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PACKAGE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField name="current_cost_price" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Kostpris (kr/enhet)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="agreed_price" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Avtalt pris (kr/enhet)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField name="description" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Beskrivelse</FormLabel>
                <FormControl><Textarea {...field} value={field.value ?? ""} rows={2} /></FormControl>
              </FormItem>
            )} />
            <FormField name="is_packaging" control={form.control} render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel className="text-sm">Emballasje</FormLabel>
                  <p className="text-xs text-ink-secondary">Skjuler næring og allergen-tab</p>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
              <Button type="submit" disabled={create.isPending}>Opprett</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
